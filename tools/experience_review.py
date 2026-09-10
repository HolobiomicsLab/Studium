#!/usr/bin/env python3
"""Render a source-linked draft through Studium's existing ASTRA/MySTRA machinery.

Usage: python tools/experience_review.py CHECKED_REVIEW_DIR
Adds astra.yaml and course_provenance.myst.md; refuses existing outputs.
This is a provenance view, not an approval or an assessment of scientific validity.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from experience_packet import (
    LessonPlan, PacketError, SourceLink, _validate_packet, _validate_links,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "planner"))
from agentic.decision import make_decision, make_insight  # noqa: E402
from provenance.astra_emit import emit_astra, write_astra_yaml  # noqa: E402
from astra_render import render  # noqa: E402


def _read_json(directory: Path, name: str):
    return json.loads((directory / name).read_text(encoding="utf-8"))


def _source_findings(links, sources, created_at):
    findings = []
    for index, link in enumerate(links):
        source = sources[link.evidence_id]
        evidence = {
            "artifact": "evidence.json", "quote": {"exact": link.quote},
            "snapshot": "evidence.json",
            "location": {"value": link.evidence_id},
        }
        if source.get("source_doi"):
            evidence["doi"] = source["source_doi"]
        findings.append(make_insight(
            insight_id=f"source-link-{index}",
            claim=f"Draft scene {link.scene_id} links to captured passage {link.evidence_id}. "
                  "Exact quotation linkage is not scientific or pedagogical approval.",
            created_at=created_at, evidence=[evidence], derived=True,
        ))
    return findings


def write_experience_provenance(directory: Path) -> Path:
    """Add a MySTRA-readable draft record from checked plan, evidence and source links."""
    directory = directory.resolve()
    for name in ("astra.yaml", "course_provenance.myst.md"):
        if (directory / name).exists():
            raise PacketError(f"output already exists: {directory / name}")
    plan = LessonPlan.model_validate(_read_json(directory, "plan.json"))
    if plan.status.value != "draft" or plan.validated_by is not None:
        raise PacketError("expected an unapproved draft")
    sources = _validate_packet(_read_json(directory, "evidence.json"))
    links = [SourceLink.model_validate(row) for row in _read_json(directory, "source_links.json")["source_links"]]
    _validate_links(links, sources, {scene.id for scene in plan.scene_outlines})
    decision = make_decision(
        decision_id="publication", label="Draft for teacher review",
        rationale="Source linkage was checked mechanically. Scientific accuracy, pedagogy, "
                  "execution fidelity and student publication remain unapproved.",
        options=[{"id": "draft", "label": "Unapproved draft"}], default="draft",
    )
    document = emit_astra(
        analysis_id=plan.id, name=f"DRAFT — {plan.title}", decisions=[decision],
        prior_insights=[], findings=_source_findings(links, sources, datetime.now(timezone.utc).isoformat()),
        outputs=[{"id": "draft_plan", "type": "data", "format": "json", "description": "plan.json: existing LessonPlan; draft, no teacher approval."}],
    )
    write_astra_yaml(document, str(directory))
    (directory / "course_provenance.myst.md").write_text(render(directory), encoding="utf-8")
    return directory


def main() -> int:
    """Render one checked review directory and return a diagnostic process status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        print(write_experience_provenance(args.directory))
    except (OSError, ValueError, KeyError) as exc:
        print(f"experience review: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
