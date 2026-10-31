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
    LessonPlan, PacketError, SourceLink, ViewerBrief, _validate_asb,
    _validate_corpus, _validate_embedded_evidence, _validate_links,
    _validate_packet, _validate_plan_graph, _validate_viewers,
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


def validate_review_values(plan_value, evidence, links_value, viewers_value):
    """Validate one captured snapshot of a review package's JSON values."""
    plan = LessonPlan.model_validate(plan_value)
    if plan.status.value != "draft" or plan.validated_by is not None:
        raise PacketError("expected an unapproved draft plus a separate approval receipt")
    sources = _validate_packet(evidence)
    links = [
        SourceLink.model_validate(row)
        for row in links_value["source_links"]
    ]
    viewers = [ViewerBrief.model_validate(row) for row in viewers_value]
    asb_task = evidence.get("asb_task")
    asb_source = {asb_task["source_id"]} if isinstance(asb_task, dict) else set()
    allowed_sources = set(sources) | asb_source
    _, scene_ids = _validate_plan_graph(plan, allowed_sources)
    _validate_corpus(plan, sources, asb_task if isinstance(asb_task, dict) else None)
    _validate_asb(plan, evidence)
    _validate_embedded_evidence(plan, sources)
    _validate_links(links, sources, scene_ids)
    _validate_viewers(viewers, scene_ids, allowed_sources)
    return plan, sources, links, viewers


def validate_review_directory(directory: Path):
    """Validate the editable plan and every checked supporting-input relationship."""
    return validate_review_values(
        _read_json(directory, "plan.json"),
        _read_json(directory, "evidence.json"),
        _read_json(directory, "source_links.json"),
        _read_json(directory, "viewers.json"),
    )


def _workflow_decisions(approval):
    if approval is None:
        return [make_decision(
            decision_id="publication", label="Draft for teacher review",
            rationale="Source linkage was checked mechanically. Scientific accuracy, pedagogy, "
                      "execution fidelity and student publication remain unapproved.",
            options=[{"id": "draft", "label": "Unapproved draft"}], default="draft",
        )]
    return [
        make_decision(
            decision_id="plan_approval", label="Reviewed plan revision",
            rationale=f"Approved locally by {approval['approved_by']} at "
                      f"{approval['approved_at']}; identity is operator-declared, not authenticated.",
            options=[{"id": "approved_for_synthesis", "label": "Approved for synthesis"}],
            default="approved_for_synthesis",
        ),
        make_decision(
            decision_id="publication", label="Generated-content and student release",
            rationale="Plan approval permits synthesis only; generated content still requires "
                      "teacher review and student release remains unapproved.",
            options=[{"id": "not_approved", "label": "Not approved for students"}],
            default="not_approved",
        ),
    ]


def _exploration_findings(explorations, created_at):
    findings = []
    for row in explorations:
        sources = ", ".join(
            f"{source['id']} ({source['locator']})" for source in row["sources"]
        ) or "none"
        artifacts = ", ".join(
            f"{item['path']} [{item['role']}, {item['sha256']}]"
            for item in row["materials"]
        ) or "none"
        checks = ", ".join(
            f"{check['name']}={'pass' if check['passed'] else 'fail'}"
            for action in row["actions"] for check in action["checks"]
        ) or "none reported"
        findings.append(make_insight(
            insight_id=f"exploration-{row['id'][:16]}",
            claim=f"Exploration receipt {row['id']} for scene {row['scene_id']} was integrity-"
                  f"verified when attached. Execution and checks remain operator-reported "
                  f"({checks}). Source refs: {sources}. Artifact refs: {artifacts}. Structured "
                  "learner fields and material contents are excluded; the summary retains only "
                  "operator-supplied technical metadata.",
            created_at=created_at,
            evidence=[{"artifact": "exploration_summaries",
                       "snapshot": "exploration-summaries.json"}],
            derived=True,
        ))
    return findings


def _workflow_findings(approval, synthesis, failure, explorations, created_at):
    findings = []
    if approval:
        findings.append(make_insight(
            insight_id="approval-receipt-check",
            claim=f"Receipt {approval['receipt_hash']} binds plan {approval['plan_hash']} and "
                  "supporting inputs. The digest detects edits but operator-declared identity "
                  "is not authenticated.",
            created_at=created_at,
            evidence=[{"artifact": "plan_approval", "snapshot": "plan-approval.json"}],
            derived=True,
        ))
    if synthesis:
        checks = ", ".join(
            row["check"] for row in synthesis["checks"] if row.get("passed")
        )
        findings.append(make_insight(
            insight_id="synthesized-artifact-check",
            claim=f"Artifact hash {synthesis['artifact_sha256']} is linked to the reviewed "
                  f"receipt. Actual passing checks: {checks}. Generated content and student "
                  "release remain unapproved.",
            created_at=synthesis["synthesized_at"],
            evidence=[{"artifact": "synthesized_bundle", "snapshot": "synthesis.json"}],
            derived=True,
        ))
    if failure:
        validity = (
            "The reviewed receipt remains valid and the operation is retryable"
            if approval else
            "The prior approval is no longer current; review and approval are required again"
        )
        findings.append(make_insight(
            insight_id="latest-synthesis-failure",
            claim=f"Synthesis failed ({failure['error_type']}: {failure['error']}). {validity}; "
                  "no distribution approval was recorded.",
            created_at=failure["attempted_at"],
            evidence=[{"artifact": "synthesis_attempts", "snapshot": "synthesis-attempts.jsonl"}],
            derived=True,
        ))
    return findings + _exploration_findings(explorations, created_at)


def _workflow_outputs(approval, synthesis, failure, explorations):
    outputs = [{"id": "draft_plan", "type": "data", "format": "json",
                "description": "plan.json: editable LessonPlan revision."}]
    if approval:
        outputs.append({"id": "plan_approval", "type": "data", "format": "json",
                        "description": "Local integrity receipt; identity is operator-declared."})
    if synthesis:
        outputs.append({"id": "synthesized_bundle", "type": "data", "format": "zip",
                        "description": f"Generated artifact {synthesis['artifact_uri']} bound by "
                                       f"SHA-256 {synthesis['artifact_sha256']}."})
    if failure:
        outputs.append({"id": "synthesis_attempts", "type": "data", "format": "jsonl",
                        "description": "Retryable synthesis-attempt record."})
    if explorations:
        outputs.append({"id": "exploration_summaries", "type": "data", "format": "json",
                        "description": "Technical summaries of receipts verified at attachment; "
                                       "structured learner fields, portable receipts and blobs "
                                       "are not copied. Operator metadata still needs review."})
    return outputs


def _experience_document(directory, approval=None, synthesis=None, failure=None):
    plan, sources, links, _ = validate_review_directory(directory)
    summaries_path = directory / "exploration-summaries.json"
    summary_index = _read_json(directory, summaries_path.name) if summaries_path.exists() else {}
    explorations = summary_index.get("explorations", [])
    created_at = approval["approved_at"] if approval else datetime.now(timezone.utc).isoformat()
    findings = _source_findings(links, sources, created_at)
    findings += _workflow_findings(approval, synthesis, failure, explorations, created_at)
    state = "REVIEWED" if approval else "DRAFT"
    return emit_astra(
        analysis_id=plan.id,
        name=f"{state} — {plan.title}",
        decisions=_workflow_decisions(approval),
        prior_insights=[],
        findings=findings,
        inputs=[
            {"id": "captured_sources", "type": "data",
             "description": "evidence.json: captured source passages."},
            {"id": "reviewed_plan", "type": "data",
             "description": "plan.json: exact revision displayed and, when approved, synthesized."},
        ],
        outputs=_workflow_outputs(approval, synthesis, failure, explorations),
    )


def refresh_experience_provenance(directory: Path, *, approval=None, synthesis=None,
                                  failure=None) -> Path:
    """Regenerate the MySTRA view from the local review-package records."""
    directory = directory.resolve()
    write_astra_yaml(
        _experience_document(directory, approval, synthesis, failure), str(directory)
    )
    (directory / "course_provenance.myst.md").write_text(
        render(directory), encoding="utf-8"
    )
    return directory


def write_experience_provenance(directory: Path) -> Path:
    """Add a MySTRA-readable draft record from checked plan, evidence and source links."""
    directory = directory.resolve()
    for name in ("astra.yaml", "course_provenance.myst.md"):
        if (directory / name).exists():
            raise PacketError(f"output already exists: {directory / name}")
    document = _experience_document(directory)
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
