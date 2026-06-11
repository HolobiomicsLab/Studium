"""Stage 4 — REPORT + FEEDBACK.

Renders the audit dict into a human-readable report.md and a refinement-feedback
list mapping each finding back to a REVIEW-FINDINGS.md backlog id. The report is
the measurement instrument the loop strategy calls for: re-run after each backlog
fix and diff the dimension scores / findings.
"""

from __future__ import annotations

import json
from pathlib import Path

_SEV_EMOJI = {"blocker": "[BLOCKER]", "high": "[HIGH]", "medium": "[MED]", "low": "[LOW]", "info": "[info]"}


def render_report(audit: dict, run_dir: Path) -> str:
    lines: list[str] = []
    a = audit
    lines.append(f"# Studium eval report — corpus {a.get('corpus_id')}: {a.get('corpus_title')}")
    lines.append("")
    lines.append(f"- Auditor: `{a.get('auditor')}`")
    lines.append(f"- Author mode: `{a.get('author_mode')}`")
    lines.append(f"- Overall score: **{a.get('overall_score')}** / 1.0")
    lines.append(f"- Run dir: `{run_dir}`")
    lines.append("")

    lines.append("## Dimension scores")
    lines.append("")
    lines.append("| Dimension | Score |")
    lines.append("|---|---|")
    for dim, score in a.get("dimension_scores", {}).items():
        lines.append(f"| {dim} | {score:.2f} |")
    lines.append("")

    lines.append("## Harness signals")
    lines.append("")
    for k, v in a.get("harness_signals", {}).items():
        lines.append(f"- `{k}`: {v}")
    lines.append("")

    lines.append("## Per-persona trajectories")
    lines.append("")
    for persona, sig in a.get("persona_signals", {}).items():
        lines.append(f"### {persona}")
        lines.append(f"- completed: {sig.get('completed')} · turns: {sig.get('n_turns')} "
                     f"· autonomyRatio: {sig.get('autonomyRatio')}")
        lines.append(f"- transitions: {sig.get('transition_kinds')}")
        lines.append(f"- adaptation rules fired: {sig.get('adaptation_rules_fired')}")
        lines.append(f"- final concept mastery: {json.dumps(sig.get('final_concept_mastery', {}))}")
        lines.append("")

    lines.append("## Findings (severity-ordered) + backlog mapping")
    lines.append("")
    lines.append("| Sev | Dimension | Finding | backlog_ref | evidence |")
    lines.append("|---|---|---|---|---|")
    for f in a.get("findings", []):
        sev = _SEV_EMOJI.get(f["severity"], f["severity"])
        summary = f["summary"].replace("|", "\\|")
        lines.append(f"| {sev} | {f['dimension']} | {summary} | `{f['backlog_ref']}` | `{f['evidence_path']}` |")
    lines.append("")

    if a.get("claude_audit"):
        lines.append("## Claude auditor (LLM augmentation)")
        lines.append("")
        ca = a["claude_audit"]
        if isinstance(ca, dict) and ca.get("pedagogical_narrative"):
            lines.append(f"> {ca['pedagogical_narrative']}")
            lines.append("")
            for sug in ca.get("course_refinement", []):
                lines.append(f"- refine: {sug}")
        else:
            lines.append(f"_({json.dumps(ca)})_")
        lines.append("")

    lines.append("## Refinement feedback (loop signal)")
    lines.append("")
    lines.append("Each actionable finding maps to a REVIEW-FINDINGS.md backlog item. Re-run the harness "
                 "after a fix and diff this section.")
    lines.append("")
    for f in a.get("findings", []):
        if f["severity"] in ("blocker", "high", "medium"):
            lines.append(f"- **{f['backlog_ref']}** ({f['severity']}): {f['summary']}")
    lines.append("")

    return "\n".join(lines)


def write_report(audit: dict, run_dir: Path) -> Path:
    md = render_report(audit, run_dir)
    out = run_dir / "report.md"
    out.write_text(md, encoding="utf-8")
    # also a machine-readable feedback list keyed by backlog ref
    feedback: dict[str, list[str]] = {}
    for f in audit.get("findings", []):
        if f["severity"] in ("blocker", "high", "medium"):
            feedback.setdefault(f["backlog_ref"], []).append(f"[{f['severity']}] {f['summary']}")
    (run_dir / "refinement_feedback.json").write_text(
        json.dumps(feedback, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return out


__all__ = ["render_report", "write_report"]
