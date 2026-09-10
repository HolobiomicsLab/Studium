#!/usr/bin/env python3
"""astra_render.py — MySTRA: render a course's provenance artifacts as one MyST page.

MySTRA = MyST + ASTRA (Lightcone AAI4Science idea): the report is RENDERED FROM the
structured record, never free-authored, so the page cannot drift from the artifacts.
Input is a course output directory as the planner writes it:

  astra.yaml                    ASTRA document (ASB `analyses:` shape; flat legacy accepted)
  universes/*.yaml              option selections (nested shape; flat legacy accepted)
  trace/exploration_tree.yaml   ARA exploration trace (schema 0.1.0)
  review/<bundle_id>/astra.yaml  scene-review verdicts, one per judged bundle (optional,
                                from eval/harness/scene_judge.py; flat `review/astra.yaml`
                                is the legacy location and is still read)

Reading those files is `provenance.astra_read.load_course`, shared with the Studium
Observatory; this module only formats. Output: <dir>/course_provenance.myst.md —
decisions with alternatives and exclusions, universes, the exploration tree (mermaid +
nested list), findings, review verdicts.

Usage:
  python tools/astra_render.py <course_out_dir> [--out FILE]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "planner"))

from provenance.astra_emit import source_edge_id  # noqa: E402
from provenance.astra_read import (  # noqa: E402
    ReviewDoc, analyses_of, evidence_view, load_course, load_yaml, universe_selection,
    universe_summary_lines,
)

# The reading helpers moved to provenance.astra_read; these names stay for callers
# that import them from here.
_load_yaml = load_yaml
_universe_selection = universe_selection


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


def _artifact_lines(kind: str, artifacts: Any) -> list[str]:
    """Render every declared input or output, including its useful context."""
    lines = [f"**{kind}:**"]
    if not isinstance(artifacts, list) or not artifacts:
        return [*lines, "- none recorded", ""]
    for artifact in artifacts:
        if not isinstance(artifact, Mapping):
            lines.append(f"- unreadable declaration: `{type(artifact).__name__}`")
            continue
        artifact_id = artifact.get("id", "unnamed")
        details = [str(artifact[key]) for key in ("type", "format") if artifact.get(key)]
        if artifact.get("from"):
            details.append(f"from `{artifact['from']}`")
        suffix = f" — {'; '.join(details)}" if details else ""
        lines.append(f"- `{artifact_id}`{suffix}")
        if artifact.get("description"):
            lines.append(f"  - {artifact['description']}")
    return [*lines, ""]


def _context_lines(container: Mapping[str, Any]) -> list[str]:
    """Render the input and output declarations of one ASTRA container."""
    return [*_artifact_lines("Inputs", container.get("inputs")),
            *_artifact_lines("Outputs", container.get("outputs"))]


def _analysis_heading(slug: str, analysis: Mapping[str, Any], level: int = 3) -> str:
    """Identify one nested or legacy-flat analysis in a stable heading."""
    name = analysis.get("name")
    suffix = f" — {name}" if name and name != slug else ""
    return f"{'#' * level} Analysis `{slug}`{suffix}"


def _evidence_lines(evidence: Any) -> list[str]:
    """Render every evidence record and its source and exact quotation."""
    if not isinstance(evidence, list) or not evidence:
        return ["  - Evidence: none recorded"]
    lines: list[str] = []
    for index, item in enumerate(evidence, start=1):
        if not isinstance(item, Mapping):
            lines.append(f"  - Evidence {index}: unreadable `{type(item).__name__}`")
            continue
        view = evidence_view(item)
        artifact = f" — artifact `{view['artifact']}`" if view["artifact"] else ""
        lines.append(f"  - Evidence `{view['id'] or index}`{artifact}")
        if view["quote_exact"] is not None:
            lines.append(f"    - Exact quote: {view['quote_exact']}")
        lines.extend(f"    - {label}: {value}" for label, value in view["details"].items())
    return lines


def _finding_lines(findings: Any) -> list[str]:
    """Render every finding with all of its evidence records."""
    if not isinstance(findings, Mapping) or not findings:
        return ["No findings recorded.", ""]
    lines: list[str] = []
    for fslug, finding in findings.items():
        if not isinstance(finding, Mapping):
            lines.extend([f"- `{fslug}` — unreadable finding", ""])
            continue
        lines.append(f"- `{source_edge_id(finding, str(fslug))}` — {finding.get('claim', '')}")
        lines.extend(_evidence_lines(finding.get("evidence")))
    return [*lines, ""]


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


def _review_identity(bundle_id: str, rel: str) -> list[str]:
    """Name a per-bundle or legacy review and its source artifact."""
    identity = (f"bundle `{bundle_id}` (bundle directory)" if bundle_id
                else "legacy course review")
    return [f"**Review:** {identity}", f"**Artifact:** `{rel}`", ""]


def _review_analysis_lines(slug: str, body: Mapping[str, Any]) -> list[str]:
    """Render one review analysis without treating an empty body as a pass."""
    decisions = body.get("decisions")
    rows = [(str(key), value) for key, value in decisions.items()
            if isinstance(value, Mapping)] if isinstance(decisions, Mapping) else []
    lines = [_analysis_heading(slug, body), "", *_context_lines(body)]
    lines += _review_verdict_lines(rows)
    findings = body.get("findings")
    if isinstance(findings, Mapping) and findings:
        lines.extend(["#### Findings", "", *_finding_lines(findings)])
    return lines


def _review_verdict_lines(rows: list[tuple[str, Mapping[str, Any]]]) -> list[str]:
    """Render all review decisions, ordered with non-passing verdicts first."""
    if not rows:
        return ["No judged dimensions recorded.", ""]
    non_pass = [(key, decision) for key, decision in rows
                if decision.get("default") != "pass"]
    passing = [(key, decision) for key, decision in rows
               if decision.get("default") == "pass"]
    lines = [f"{len(rows)} judged dimension(s); **{len(non_pass)} not passing**.", ""]
    for dslug, decision in [*non_pass, *passing]:
        label = decision.get("label", dslug)
        lines.append(
            f"- **{label}** (`{source_edge_id(decision, dslug)}`) → "
            f"**{decision.get('default')}** — {decision.get('rationale', '')}"
        )
    if not non_pass:
        lines.append("All judged dimensions pass.")
    return [*lines, ""]


def _review_section(review_doc: dict[str, Any], *, bundle_id: str = "",
                    rel: str = "review/astra.yaml") -> list[str]:
    """Scene-review verdicts for every nested analysis, identified by source."""
    lines = ["## Scene review", "", *_review_identity(bundle_id, rel)]
    lines += _context_lines(review_doc)
    analyses = analyses_of(review_doc)
    if not analyses:
        return [*lines, "No review analyses recorded.", ""]
    for slug, body in analyses:
        lines += _review_analysis_lines(slug, body)
    return lines


def _incomplete_review_section(review: ReviewDoc, reason: str) -> list[str]:
    """Render a review identity whose ASTRA analysis is unavailable."""
    lines = ["## Scene review", "", *_review_identity(review.bundle_id, review.rel),
             f"ASTRA analysis unavailable: **{reason}**.", ""]
    if review.verdicts is not None:
        lines.extend(["The verdicts artifact is present, but it cannot replace the missing "
                      "ASTRA provenance analysis.", ""])
    return lines


def render(course_dir: Path) -> str:
    """Compose the MyST page from whatever artifacts the directory carries."""
    docs = load_course(course_dir)  # strict: no astra.yaml -> FileNotFoundError
    doc = docs.astra
    analyses = analyses_of(doc)
    analysis_names = ", ".join(f"`{slug}`" for slug, _ in analyses) or "none recorded"
    document_name = str(doc.get("name") or (analyses[0][0] if analyses else "course"))
    frontmatter_title = json.dumps(
        f"{document_name} — course provenance", ensure_ascii=False)
    lines = [
        "---", f"title: {frontmatter_title}", "---", "",
        f"# {document_name}", "",
        f"> Rendered from the versioned artifacts in `{docs.course_dir.name}/` "
        f"(ASTRA {doc.get('version', '?')}, analyses {analysis_names}). Generated by "
        "`tools/astra_render.py`; do not edit by hand.", "",
        "## Document context", "", *_context_lines(doc),
        "## Analyses", "",
    ]
    if analyses:
        for slug, analysis in analyses:
            lines.extend([_analysis_heading(slug, analysis), "", *_context_lines(analysis)])
    else:
        lines.extend(["No analyses recorded.", ""])

    lines += ["## Decisions", ""]
    for slug, analysis in analyses:
        lines.extend([_analysis_heading(slug, analysis), ""])
        decisions = analysis.get("decisions")
        if not isinstance(decisions, Mapping) or not decisions:
            lines.extend(["No decisions recorded.", ""])
            continue
        for dslug, decision in decisions.items():
            if isinstance(decision, Mapping):
                lines.extend(_decision_lines(str(dslug), dict(decision)))
            else:
                lines.extend([f"- `{dslug}` — unreadable decision", ""])

    if docs.universes:
        # What each universe CHANGES, not everything it selects. The emitter assigns every
        # decision of the analysis so no selection reads `[MISSING_DECISION]`, so the full
        # list is the default list repeated once per universe and the delta — the only thing
        # a universe is — is buried in it (INT-STUDIUM-010 nit 3).
        lines += ["## Universes", "",
                  "Each universe is a delta: the decisions it moves, then a count of the "
                  "ones it leaves at their default.", ""]
        for u in docs.universes:
            lines.append(f"- **{u.get('id', '')}** — {u.get('description', '')}")
            lines += universe_summary_lines(u, docs.astra)
        lines.append("")

    trace = docs.trace
    if trace:
        lines += ["## Exploration trace", "",
                  f"Schema {trace.get('schema_version', '?')} — the build's journey, "
                  "alternatives included.", ""]
        lines += _trace_mermaid(trace.get("nodes") or [])
        lines += _trace_bullets(trace.get("nodes") or []) + [""]

    lines += ["## Findings", ""]
    for slug, analysis in analyses:
        lines.extend([_analysis_heading(slug, analysis), "",
                      *_finding_lines(analysis.get("findings"))])

    for review in docs.reviews:
        if review.astra is not None:
            lines += _review_section(
                review.astra, bundle_id=review.bundle_id, rel=review.rel)
        else:
            reason = docs.absent.get(review.rel, "unavailable")
            lines += _incomplete_review_section(review, reason)

    if docs.absent:
        lines += ["## Artifact gaps", ""]
        for rel, reason in sorted(docs.absent.items()):
            lines.append(f"- `{rel}` — **{reason}**")
        lines.append("")
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
