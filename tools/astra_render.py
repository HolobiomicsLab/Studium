#!/usr/bin/env python3
"""astra_render.py — MySTRA: render a course's provenance artifacts as one MyST page.

MySTRA = MyST + ASTRA (Lightcone AAI4Science idea): the report is RENDERED FROM the
structured record, never free-authored, so the page cannot drift from the artifacts.
Input is a course output directory as the planner writes it:

  astra.yaml                    ASTRA document (ASB `analyses:` shape; flat legacy accepted)
  universes/*.yaml              option selections (nested shape; flat legacy accepted)
  trace/exploration_tree.yaml   ARA exploration trace (schema 0.1.0)
  review/astra.yaml             scene-review verdicts (optional, from eval/harness/scene_judge.py)

Output: <dir>/course_provenance.myst.md — decisions with alternatives and exclusions,
universes, the exploration tree (mermaid + nested list), findings, review verdicts.

Usage:
  python tools/astra_render.py <course_out_dir> [--out FILE]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "planner"))

from provenance.astra_emit import SOURCE_ID_FIELD, analysis_body  # noqa: E402


def _load_yaml(path: Path) -> dict[str, Any] | None:
    import yaml
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _universe_selection(universe: dict[str, Any]) -> dict[str, Any]:
    """Option selection of a universe in either shape (nested merged, or flat)."""
    analyses = universe.get("analyses")
    if not analyses:
        return universe.get("decisions") or {}
    merged: dict[str, Any] = {}
    for body in analyses.values():
        merged.update(body.get("decisions") or {})
    return merged


def _decision_lines(dslug: str, d: dict[str, Any]) -> list[str]:
    """One decision as a MyST bullet: chosen option, alternatives, exclusions."""
    options = d.get("options") or {}
    default = d.get("default")
    chosen = (options.get(default) or {}).get("label", default)
    lines = [f"**{d.get('label', dslug)}** (`{dslug}`) — chose **{chosen}**",
             f": {d.get('rationale', '')}"]
    for oid, o in options.items():
        if oid == default:
            continue
        suffix = f" — excluded: {o['excluded_reason']}" if o.get("excluded_reason") else ""
        lines.append(f"  - alternative: {o.get('label', oid)}{suffix}")
    lines.append("")
    return lines


def _trace_mermaid(nodes: list[dict[str, Any]]) -> list[str]:
    """The exploration tree as a mermaid flowchart (structure only, labels quoted)."""
    edges: list[str] = []

    def _emit(node: dict[str, Any]) -> None:
        label = str(node.get("title", node["id"])).replace('"', "'")
        shape = f'{node["id"]}{{"{label}"}}' if node["type"] == "decision" else f'{node["id"]}["{label}"]'
        edges.append(f"  {shape}")
        for child in node.get("children") or []:
            edges.append(f'  {node["id"]} --> {child["id"]}')
            _emit(child)

    for n in nodes:
        _emit(n)
    return ["```{mermaid}", "flowchart TB", *edges, "```", ""]


def _trace_bullets(nodes: list[dict[str, Any]], depth: int = 0) -> list[str]:
    lines: list[str] = []
    for n in nodes:
        head = f"{'  ' * depth}- `{n['id']}` **{n['type']}** — {n.get('title', '')}"
        if n.get("choice"):
            head += f" → chose *{n['choice']}*"
        lines.append(head)
        for alt in n.get("alternatives") or []:
            lines.append(f"{'  ' * (depth + 1)}- alternative: {alt}")
        lines.extend(_trace_bullets(n.get("children") or [], depth + 1))
    return lines


def _review_section(review_doc: dict[str, Any]) -> list[str]:
    """Scene-review verdicts: worst-case first, then every non-pass with its harm."""
    _, body = analysis_body(review_doc)
    rows = [(dslug, d) for dslug, d in (body.get("decisions") or {}).items()]
    non_pass = [(s, d) for s, d in rows if d.get("default") != "pass"]
    lines = ["## Scene review", "",
             f"{len(rows)} judged dimension(s); **{len(non_pass)} not passing**.", ""]
    for dslug, d in non_pass:
        lines.append(f"- `{d.get(SOURCE_ID_FIELD, dslug)}` → **{d.get('default')}** — "
                     f"{d.get('rationale', '')}")
    if not non_pass and rows:
        lines.append("All judged dimensions pass.")
    lines.append("")
    return lines


def render(course_dir: Path) -> str:
    """Compose the MyST page from whatever artifacts the directory carries."""
    doc = _load_yaml(course_dir / "astra.yaml")
    if doc is None:
        raise FileNotFoundError(f"no astra.yaml under {course_dir}")
    slug, analysis = analysis_body(doc)
    lines = [
        "---", f'title: "{doc.get("name", slug)} — course provenance"', "---", "",
        f"# {doc.get('name', slug)}", "",
        f"> Rendered from the versioned artifacts in `{course_dir.name}/` "
        f"(ASTRA {doc.get('version', '?')}, analysis `{slug}`). Generated by "
        "`tools/astra_render.py`; do not edit by hand.", "",
        "## Decisions", "",
    ]
    for dslug, d in (analysis.get("decisions") or {}).items():
        lines.extend(_decision_lines(dslug, d))

    universes = sorted((course_dir / "universes").glob("*.yaml")) if (course_dir / "universes").is_dir() else []
    if universes:
        lines += ["## Universes", ""]
        for upath in universes:
            u = _load_yaml(upath) or {}
            lines.append(f"- **{u.get('id', upath.stem)}** — {u.get('description', '')}")
            for did, opt in _universe_selection(u).items():
                lines.append(f"  - {did}: `{opt}`")
        lines.append("")

    trace = _load_yaml(course_dir / "trace" / "exploration_tree.yaml")
    if trace:
        lines += ["## Exploration trace", "",
                  f"Schema {trace.get('schema_version', '?')} — the build's journey, "
                  "alternatives included.", ""]
        lines += _trace_mermaid(trace.get("nodes") or [])
        lines += _trace_bullets(trace.get("nodes") or []) + [""]

    findings = analysis.get("findings") or {}
    if findings:
        lines += ["## Findings", ""]
        for fslug, f in findings.items():
            lines.append(f"- `{f.get(SOURCE_ID_FIELD, fslug)}` — {f.get('claim', '')}")
        lines.append("")

    review = _load_yaml(course_dir / "review" / "astra.yaml")
    if review:
        lines += _review_section(review)
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Render course provenance artifacts as a MyST page")
    ap.add_argument("course_dir", help="planner output dir holding astra.yaml")
    ap.add_argument("--out", default=None, help="output file (default: <dir>/course_provenance.myst.md)")
    args = ap.parse_args()
    course_dir = Path(args.course_dir)
    page = render(course_dir)
    out = Path(args.out) if args.out else course_dir / "course_provenance.myst.md"
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(page.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
