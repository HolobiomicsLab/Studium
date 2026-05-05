#!/usr/bin/env python3
"""
memory_cli.py — CLI minimale pour la mémoire agentique Markdown.

Inspiré de project_magnolia (taojiang9914). Stdlib uniquement.

Usage:
    python tools/memory_cli.py log-entry    --title "..." [--tags a,b] [--type research|entry]
    python tools/memory_cli.py log-decision --title "..." [--tags a,b]
    python tools/memory_cli.py log-rule     --title "..." [--tags a,b] [--scope preparation|construction|all]
    python tools/memory_cli.py daily        [--note "..."]
    python tools/memory_cli.py reindex
    python tools/memory_cli.py query        [--tag TAG] [--type TYPE]

Conventions:
  - Tous les fichiers dans .memory/{entries,decisions,rules,daily}/
  - Nommage: NNN_slug.md (numérotation auto par type)
  - Front-matter YAML obligatoire
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path


MEMORY_DIR = Path(__file__).resolve().parent.parent / ".memory"
TEMPLATES = MEMORY_DIR / "templates"

SUBDIRS = {
    "entry": "entries",
    "research": "entries",  # research notes go with entries but tagged type=research
    "decision": "decisions",
    "rule": "rules",
    "daily": "daily",
}


# ------------------ utilitaires ------------------

def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s)
    return s.strip("-")[:60] or "untitled"


def today_iso() -> str:
    return dt.date.today().isoformat()


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def next_number(folder: Path) -> int:
    ensure_dir(folder)
    nums = []
    for f in folder.glob("[0-9][0-9][0-9]_*.md"):
        try:
            nums.append(int(f.name[:3]))
        except ValueError:
            pass
    return (max(nums) + 1) if nums else 1


def read_front_matter(md_path: Path) -> dict:
    """Parse un front-matter YAML simple (clé: valeur ou liste [a, b])."""
    text = md_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    _, fm, _ = text.split("---", 2) if text.count("---") >= 2 else ("", "", "")
    meta = {}
    for line in fm.strip().splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            items = [x.strip().strip("\"'") for x in val[1:-1].split(",") if x.strip()]
            meta[key] = items
        else:
            meta[key] = val.strip("\"'")
    return meta


# ------------------ commandes ------------------

def cmd_log(entry_type: str, title: str, tags: list[str], extra: dict | None = None) -> Path:
    subdir = SUBDIRS.get(entry_type, "entries")
    folder = MEMORY_DIR / subdir
    ensure_dir(folder)
    n = next_number(folder)
    slug = slugify(title)
    filename = f"{n:03d}_{slug}.md"
    path = folder / filename

    id_prefix = {
        "entry": "entry",
        "research": "research",
        "decision": "decision",
        "rule": "rule",
    }.get(entry_type, "entry")

    extra = extra or {}
    scope_line = f"scope: {extra.get('scope')}\n" if extra.get("scope") else ""

    front_matter = (
        f"---\n"
        f"id: {id_prefix}-{n:03d}\n"
        f"type: {entry_type}\n"
        f"title: \"{title}\"\n"
        f"created: {today_iso()}\n"
        f"tags: [{', '.join(tags) if tags else ''}]\n"
        f"status: active\n"
        f"{scope_line}"
        f"links: []\n"
        f"---\n\n"
    )

    body = (
        f"# {title}\n\n"
        f"## Contexte\n\n*à remplir*\n\n"
        f"## Contenu\n\n*à remplir*\n\n"
        f"## Liens\n\n- \n\n"
        f"## Historique\n\n- {today_iso()} : création via memory_cli.\n"
    )

    path.write_text(front_matter + body, encoding="utf-8")
    print(f"✓ {entry_type} créé : {path.relative_to(MEMORY_DIR.parent)}")
    return path


def cmd_daily(note: str | None) -> Path:
    folder = MEMORY_DIR / "daily"
    ensure_dir(folder)
    today = today_iso()
    path = folder / f"{today}.md"
    if not path.exists():
        content = (
            f"---\n"
            f"id: daily-{today}\n"
            f"type: daily\n"
            f"title: \"Daily — {today}\"\n"
            f"created: {today}\n"
            f"tags: [daily]\n"
            f"status: active\n"
            f"---\n\n"
            f"# Daily — {today}\n\n"
            f"## Ce qui a avancé\n\n- \n\n"
            f"## Décisions prises\n\n- \n\n"
            f"## Entries créées\n\n- \n\n"
            f"## Ce qui bloque\n\n- \n\n"
            f"## Questions à remonter\n\n- \n\n"
            f"## Suite prévue\n\n- \n"
        )
        path.write_text(content, encoding="utf-8")
        print(f"✓ daily créé : {path.relative_to(MEMORY_DIR.parent)}")
    else:
        print(f"→ daily existe déjà : {path.relative_to(MEMORY_DIR.parent)}")

    if note:
        with path.open("a", encoding="utf-8") as f:
            f.write(f"\n### Ajout {dt.datetime.now().strftime('%H:%M')}\n\n{note}\n")
        print(f"  ajouté une note horodatée.")

    return path


def cmd_reindex() -> Path:
    index_path = MEMORY_DIR / "INDEX.md"
    sections = {
        "Décisions": MEMORY_DIR / "decisions",
        "Rules": MEMORY_DIR / "rules",
        "Entries": MEMORY_DIR / "entries",
        "Daily notes": MEMORY_DIR / "daily",
    }

    lines = ["# INDEX", "", "*Généré par `python tools/memory_cli.py reindex`. Ne pas éditer à la main.*", ""]
    for section, folder in sections.items():
        lines.append(f"## {section}")
        lines.append("")
        if not folder.exists():
            lines.append("*(dossier absent)*")
            lines.append("")
            continue
        files = sorted(folder.glob("*.md"))
        if not files:
            lines.append("*(vide)*")
            lines.append("")
            continue
        for f in files:
            meta = read_front_matter(f)
            title = meta.get("title", f.stem).strip('"')
            created = meta.get("created", "")
            tags = meta.get("tags", [])
            tags_str = " ".join(f"#{t}" for t in tags) if tags else ""
            link_target = f.stem
            lines.append(f"- [[{link_target}]] — {created} — {title} {tags_str}".rstrip())
        lines.append("")

    lines.append(f"---\n\nDernière régénération : {today_iso()}.")
    index_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"✓ INDEX regénéré : {index_path.relative_to(MEMORY_DIR.parent)}")
    return index_path


def cmd_query(tag: str | None, type_filter: str | None) -> None:
    results = []
    for folder in [MEMORY_DIR / "entries", MEMORY_DIR / "decisions", MEMORY_DIR / "rules", MEMORY_DIR / "daily"]:
        if not folder.exists():
            continue
        for f in folder.glob("*.md"):
            meta = read_front_matter(f)
            if tag and tag not in (meta.get("tags") or []):
                continue
            if type_filter and meta.get("type") != type_filter:
                continue
            results.append((meta.get("created", ""), f, meta))

    results.sort(key=lambda x: x[0], reverse=True)
    if not results:
        print("(aucun résultat)")
        return

    for created, path, meta in results:
        title = meta.get("title", path.stem).strip('"')
        tags = ",".join(meta.get("tags") or [])
        print(f"  {created}  [{meta.get('type', '?'):>8}]  {title}  ({tags})")
        print(f"      {path.relative_to(MEMORY_DIR.parent)}")


# ------------------ parsing ------------------

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Memory CLI pour le workspace de préparation.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_entry = sub.add_parser("log-entry", help="Créer une entry ou une research note.")
    p_entry.add_argument("--title", required=True)
    p_entry.add_argument("--tags", default="", help="tags séparés par virgules")
    p_entry.add_argument("--type", default="entry", choices=["entry", "research"])

    p_dec = sub.add_parser("log-decision", help="Créer un ADR.")
    p_dec.add_argument("--title", required=True)
    p_dec.add_argument("--tags", default="")

    p_rule = sub.add_parser("log-rule", help="Créer une rule.")
    p_rule.add_argument("--title", required=True)
    p_rule.add_argument("--tags", default="")
    p_rule.add_argument("--scope", default="preparation", choices=["preparation", "construction", "all"])

    p_daily = sub.add_parser("daily", help="Créer / compléter la daily note du jour.")
    p_daily.add_argument("--note", default=None, help="ajoute une note horodatée")

    sub.add_parser("reindex", help="Régénère .memory/INDEX.md.")

    p_q = sub.add_parser("query", help="Cherche par tag ou type.")
    p_q.add_argument("--tag", default=None)
    p_q.add_argument("--type", default=None)

    args = parser.parse_args(argv)

    def parse_tags(s: str) -> list[str]:
        return [t.strip() for t in s.split(",") if t.strip()]

    if args.cmd == "log-entry":
        cmd_log(args.type, args.title, parse_tags(args.tags))
    elif args.cmd == "log-decision":
        cmd_log("decision", args.title, parse_tags(args.tags))
    elif args.cmd == "log-rule":
        cmd_log("rule", args.title, parse_tags(args.tags), extra={"scope": args.scope})
    elif args.cmd == "daily":
        cmd_daily(args.note)
    elif args.cmd == "reindex":
        cmd_reindex()
    elif args.cmd == "query":
        cmd_query(args.tag, args.type)
    else:
        parser.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
