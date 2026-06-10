"""Render attached SceneOutline.evidence into a grounding prompt block (M2).

Reuses the bibliographic_refs already fetched by enrichment (M1/C); no MCP call.
Returns "" when there is nothing to ground on (caller's {% if %} then skips it).
"""
from __future__ import annotations
from typing import Any


def render_evidence_block(evidence: dict[str, Any] | None) -> str:
    if not evidence:
        return ""
    refs = evidence.get("bibliographic_refs") or []
    if not refs:
        return ""
    lines = ["Sources disponibles (cite en ligne par [n]) :"]
    for i, r in enumerate(refs, 1):
        title = r.get("title") or "(sans titre)"
        excerpt = (r.get("excerpt") or "").strip()
        doi = r.get("doi")
        suffix = f" (doi:{doi})" if doi else ""
        lines.append(f"[{i}] {title}{suffix} — {excerpt}")
    return "\n".join(lines)
