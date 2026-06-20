#!/usr/bin/env python3
"""FUN-MOOC / Open edX → Studium Mode-A corpus ingester (backend, no GUI).

FUN-MOOC (lms.fun-mooc.fr) is an Open edX instance. Course content is login-gated,
so this tool needs YOUR authenticated session cookie (read-only GET requests only —
it never writes to FUN-MOOC). It walks the Open edX *blocks* API, pulls the HTML of
each unit, converts it to Markdown, and emits Studium Mode-A corpus `.md` files
(with the same YAML front-matter the eval harness expects) plus manifest entries.

The output `.md` then feeds the normal author pipeline, e.g.:
    ./.venv/bin/python eval/run_eval.py --corpus <id> --author claude --audit-llm

------------------------------------------------------------------------------
Auth — how to get your cookie from Brave (no credential is stored by this tool):
  Brave → open the course page while logged in → DevTools (Cmd+Opt+I) →
  Application tab → Storage → Cookies → https://lms.fun-mooc.fr →
  copy the value of `sessionid`. Then run with:
      FUN_MOOC_COOKIE='sessionid=<value>'  python tools/funmooc_ingest.py ...
  (Or DevTools → Network → click the courseware request → Copy → "Copy as cURL",
   and paste the whole `-H 'cookie: ...'` value into --cookie.)
------------------------------------------------------------------------------

Examples:
  # 1) Preview the course outline (no content pulled):
  FUN_MOOC_COOKIE='sessionid=...' python tools/funmooc_ingest.py \
      --course 'course-v1:CNAM+01079+session01' --list

  # 2) Pull ONE subsection (the sequential hash from a courseware URL) to a corpus .md:
  FUN_MOOC_COOKIE='sessionid=...' python tools/funmooc_ingest.py \
      --course 'course-v1:CNAM+01079+session01' \
      --usage db71050940ce401399c92a40397b6a55 \
      --out ~/git/studium_eval/corpus --branch sciences --id-prefix funmooc-cnam01079

  # 3) Pull the whole course, one .md per section (chapter):
  FUN_MOOC_COOKIE='sessionid=...' python tools/funmooc_ingest.py \
      --course 'course-v1:CNAM+01079+session01' --granularity chapter \
      --out ~/git/studium_eval/corpus --branch sciences --id-prefix funmooc-cnam01079
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote

try:
    import httpx
except ImportError:  # pragma: no cover
    sys.exit("httpx is required (it's in requirements.txt): pip install httpx")

BASE = "https://lms.fun-mooc.fr"
BLOCKS_API = BASE + "/api/courses/v1/blocks/"
ME_API = BASE + "/api/user/v1/me"
# Open edX block hierarchy: course > chapter (section) > sequential (subsection) > vertical (unit) > components
CONTAINER_TYPES = {"course", "chapter", "sequential", "vertical"}


# --------------------------------------------------------------------------- #
# Minimal, dependency-free HTML → Markdown (good enough for prose/notes blocks)
# --------------------------------------------------------------------------- #
class _MdParser(HTMLParser):
    _BLOCK = {"p", "div", "section", "article", "ul", "ol", "table", "tr", "blockquote", "pre"}
    _SKIP = {"script", "style", "head", "nav", "button", "svg", "form"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip_depth = 0
        self._list_stack: list[str] = []
        self._href: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        a = dict(attrs)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.out.append("\n\n" + "#" * int(tag[1]) + " ")
        elif tag in ("p", "div", "section", "article", "blockquote", "tr"):
            self.out.append("\n\n")
        elif tag == "br":
            self.out.append("  \n")
        elif tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag in ("code", "pre"):
            self.out.append("`")
        elif tag == "ul":
            self._list_stack.append("ul")
        elif tag == "ol":
            self._list_stack.append("ol")
        elif tag == "li":
            bullet = "- " if (self._list_stack[-1:] or ["ul"])[-1] == "ul" else "1. "
            self.out.append("\n" + "  " * max(0, len(self._list_stack) - 1) + bullet)
        elif tag == "a":
            self._href = a.get("href")
            self.out.append("[")
        elif tag == "img":
            alt = a.get("alt") or "image"
            src = a.get("src") or ""
            self.out.append(f"![{alt}]({src})")

    def handle_endtag(self, tag):
        if tag in self._SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag in ("strong", "b"):
            self.out.append("**")
        elif tag in ("em", "i"):
            self.out.append("*")
        elif tag in ("code", "pre"):
            self.out.append("`")
        elif tag in ("ul", "ol"):
            if self._list_stack:
                self._list_stack.pop()
        elif tag == "a":
            href = self._href or ""
            self.out.append(f"]({href})" if href else "]")
            self._href = None
        elif tag in self._BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self._skip_depth:
            return
        self.out.append(re.sub(r"[ \t]+", " ", data))


def html_to_markdown(raw: str) -> str:
    if not raw:
        return ""
    p = _MdParser()
    try:
        p.feed(raw)
    except Exception:
        # last resort: strip tags
        return html.unescape(re.sub(r"<[^>]+>", " ", raw)).strip()
    text = "".join(p.out)
    text = html.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


def word_count(text: str) -> int:
    return len(re.findall(r"\w+", text))


def slugify(s: str, maxlen: int = 60) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:maxlen].strip("-") or "unit"


# --------------------------------------------------------------------------- #
# Open edX block tree
# --------------------------------------------------------------------------- #
@dataclass
class Block:
    usage_id: str
    type: str
    display_name: str
    children: list[str] = field(default_factory=list)
    html: str = ""
    web_url: str = ""

    @property
    def block_hash(self) -> str:
        # block-v1:ORG+NUM+RUN+type@sequential+block@<hash>  ->  <hash>
        m = re.search(r"\+block@([0-9a-fA-F]+)", self.usage_id)
        return m.group(1) if m else self.usage_id


def make_client(cookie: str) -> httpx.Client:
    headers = {
        "Cookie": cookie,
        "User-Agent": "studium-funmooc-ingest/1.0 (+backend; read-only)",
        "Accept": "application/json",
        "Referer": BASE + "/",
    }
    return httpx.Client(headers=headers, timeout=30.0, follow_redirects=False)


def whoami(client: httpx.Client) -> str | None:
    try:
        r = client.get(ME_API)
        if r.status_code == 200:
            return r.json().get("username")
    except Exception:
        pass
    return None


def fetch_blocks(client: httpx.Client, course_id: str, username: str | None) -> dict[str, Block]:
    params = {
        "course_id": course_id,
        "depth": "all",
        "requested_fields": "children,display_name,type,student_view_data,student_view_url,lms_web_url",
        "student_view_data": "html",
        "return_type": "dict",
    }
    if username:
        params["username"] = username
    else:
        params["all_blocks"] = "true"  # staff-only; falls back if it 403s
    r = client.get(BLOCKS_API, params=params)
    if r.status_code == 401:
        sys.exit("401 Unauthorized — the cookie is missing/expired. Re-copy `sessionid` from Brave (logged in).")
    if r.status_code == 403 and not username:
        sys.exit("403 — `all_blocks` needs staff. Pass --username <your FUN-MOOC username> (or let /api/user/v1/me detect it).")
    r.raise_for_status()
    raw = r.json().get("blocks", {})
    out: dict[str, Block] = {}
    for uid, b in raw.items():
        svd = b.get("student_view_data") or {}
        out[uid] = Block(
            usage_id=uid,
            type=b.get("type", "?"),
            display_name=b.get("display_name") or b.get("type", ""),
            children=b.get("children", []) or [],
            html=svd.get("html", "") if isinstance(svd, dict) else "",
            web_url=b.get("lms_web_url") or b.get("student_view_url") or "",
        )
    return out


def find_root(blocks: dict[str, Block]) -> str | None:
    return next((uid for uid, b in blocks.items() if b.type == "course"), None)


def subtree_text(blocks: dict[str, Block], uid: str, depth: int = 0) -> tuple[str, list[str]]:
    """Render a block subtree to markdown. Returns (markdown, list-of-display-names-seen)."""
    b = blocks.get(uid)
    if b is None:
        return "", []
    parts: list[str] = []
    seen: list[str] = []
    if b.type in CONTAINER_TYPES and b.type != "course":
        level = {"chapter": 2, "sequential": 3, "vertical": 4}.get(b.type, 4)
        if b.display_name:
            parts.append(f"\n\n{'#' * level} {b.display_name}")
            seen.append(b.display_name)
    if b.type == "html" and b.html:
        parts.append("\n\n" + html_to_markdown(b.html))
    elif b.type == "video":
        parts.append(f"\n\n*(video: {b.display_name})*")
    elif b.type in ("problem", "drag-and-drop-v2"):
        parts.append(f"\n\n*(interactive assessment: {b.display_name})*")
    for child in b.children:
        md, s = subtree_text(blocks, child, depth + 1)
        parts.append(md)
        seen.extend(s)
    return "".join(parts), seen


def front_matter(title: str, source_url: str, discipline: str, level: str, wc: int) -> str:
    return (
        "---\n"
        f'title: "{title}"\n'
        f'source_url: "{source_url}"\n'
        'license: "FUN-MOOC — see course page for terms (not redistributed)"\n'
        f'discipline: "{discipline}"\n'
        f'level: "{level}"\n'
        f'fetched_date: "{date.today().isoformat()}"\n'
        f"word_count: {wc}\n"
        "---\n"
    )


def emit_material(
    blocks: dict[str, Block], node_uid: str, course_id: str, out_dir: Path, branch: str,
    id_prefix: str, discipline: str, level: str, index: int,
) -> dict:
    b = blocks[node_uid]
    body_md, names = subtree_text(blocks, node_uid)
    title = b.display_name or course_id
    # promote objectives if the unit lacks them: synthesize a "Learning Objectives"
    # section from child sequential/vertical names so the deterministic author has concepts.
    objectives = "\n".join(f"- Understand: {n}" for n in names[:8]) or "- Understand the key ideas of this unit"
    course_path = f"/courses/{course_id}/courseware/"
    source_url = BASE + course_path + (b.block_hash + "/" if b.type in ("chapter", "sequential") else "")
    doc = (
        front_matter(title, source_url, discipline, level, word_count(body_md))
        + f"\n# {title}\n\n## Learning Objectives\n\nBy the end of this section, you will be able to:\n\n"
        + objectives
        + "\n" + body_md + "\n"
    )
    mid = f"{id_prefix}-{index:02d}"
    fname = f"{mid}-{slugify(title)}.md"
    dest_dir = out_dir / branch
    dest_dir.mkdir(parents=True, exist_ok=True)
    (dest_dir / fname).write_text(doc, encoding="utf-8")
    return {
        "id": mid,
        "branch": branch,
        "discipline": discipline,
        "level": level,
        "license": "FUN-MOOC (not redistributed)",
        "local_path": f"eval/corpus/{branch}/{fname}",
        "source_url": source_url,
        "summary": f"Ingested from FUN-MOOC {course_id} — '{title}'. {len(names)} sub-units.",
        "title": title,
        "word_count": word_count(body_md),
    }


def print_outline(blocks: dict[str, Block], uid: str, depth: int = 0) -> None:
    b = blocks.get(uid)
    if not b:
        return
    if b.type != "course":
        marker = {"chapter": "▸", "sequential": "  -", "vertical": "    ·"}.get(b.type, "      ·")
        tag = f"[{b.type}]" if b.type not in CONTAINER_TYPES else ""
        print(f"{'  ' * depth}{marker} {b.display_name} {tag}  ({b.block_hash})")
    for c in b.children:
        print_outline(blocks, c, depth + 1)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="FUN-MOOC / Open edX → Studium Mode-A corpus")
    ap.add_argument("--course", required=True, help="course id, e.g. course-v1:CNAM+01079+session01")
    ap.add_argument("--cookie", default=os.environ.get("FUN_MOOC_COOKIE", ""),
                    help="session cookie (or set FUN_MOOC_COOKIE), e.g. 'sessionid=...'")
    ap.add_argument("--username", default=None, help="your FUN-MOOC username (auto-detected via /api/user/v1/me if omitted)")
    ap.add_argument("--out", type=Path, default=Path.home() / "git" / "studium_eval" / "corpus")
    ap.add_argument("--branch", default="sciences", help="corpus branch folder (sciences|humanities|...)")
    ap.add_argument("--id-prefix", default="funmooc")
    ap.add_argument("--discipline", default="MOOC / FUN-MOOC")
    ap.add_argument("--level", default="undergraduate")
    ap.add_argument("--granularity", choices=["course", "chapter", "sequential"], default="chapter",
                    help="one .md per: whole course | section(chapter) | subsection(sequential)")
    ap.add_argument("--usage", default=None, help="only ingest the chapter/sequential with this block hash")
    ap.add_argument("--list", action="store_true", help="print the course outline and exit (no content written)")
    ap.add_argument("--limit", type=int, default=0, help="cap number of materials emitted (0=all)")
    args = ap.parse_args(argv)

    if not args.cookie:
        return _need_cookie()

    client = make_client(args.cookie)
    username = args.username or whoami(client)
    if args.list:
        blocks = fetch_blocks(client, args.course, username)
        root = find_root(blocks)
        if not root:
            print("no course root found (auth ok but empty tree?)"); return 1
        print(f"# {args.course}  (user={username or 'unknown'})\n")
        print_outline(blocks, root)
        return 0

    blocks = fetch_blocks(client, args.course, username)
    root = find_root(blocks)
    if not root:
        print("no course root found"); return 1

    # choose the nodes that become corpus materials
    if args.usage:
        nodes = [uid for uid, b in blocks.items() if b.block_hash == args.usage]
        if not nodes:
            print(f"usage hash {args.usage} not found in course"); return 1
    elif args.granularity == "course":
        nodes = [root]
    else:
        want = args.granularity  # chapter | sequential
        nodes = []
        def collect(uid):
            b = blocks.get(uid)
            if not b:
                return
            if b.type == want:
                nodes.append(uid); return
            for c in b.children:
                collect(c)
        collect(root)

    if args.limit:
        nodes = nodes[: args.limit]

    manifest_add = []
    for i, uid in enumerate(nodes, 1):
        entry = emit_material(blocks, uid, args.course, args.out, args.branch,
                              args.id_prefix, args.discipline, args.level, i)
        manifest_add.append(entry)
        print(f"  wrote {entry['local_path']}  ({entry['word_count']} words)")

    man_path = args.out / f"manifest_{args.id_prefix}.json"
    man_path.write_text(json.dumps(manifest_add, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(manifest_add)} material(s) written. Manifest entries -> {man_path}")
    print("Merge them into eval/corpus/manifest.json, then author with e.g.:")
    if manifest_add:
        print(f"  ./.venv/bin/python eval/run_eval.py --corpus {manifest_add[0]['id']} --author claude --audit-llm")
    return 0


def _need_cookie() -> int:
    print(__doc__.split("Examples:")[0].split("Auth")[1], file=sys.stderr)
    print("ERROR: no cookie. Set FUN_MOOC_COOKIE='sessionid=...' or pass --cookie.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
