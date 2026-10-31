#!/usr/bin/env python
"""Create labelled synthetic ASTRA/review courses in a new directory, without a model call."""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "planner" / "tests"))
from astra_course_fixture import build_course_set, build_review_set  # noqa: E402
from harness.scene_judge import write_review  # noqa: E402
from provenance.astra_emit import emit_astra, write_astra_yaml  # noqa: E402
from provenance.astra_validate import run_astra_validate  # noqa: E402


def _complete_course(course: Path) -> None:
    course.mkdir(parents=True)
    doc = build_course_set(course)
    doc["name"] = "Traitement du signal — dossier synthétique"
    second = emit_astra(
        analysis_id="evidence_audit", name="Evidence audit — synthetic",
        decisions=[], prior_insights=[], outputs=[{"id": "audit_notes", "type": "data", "format": "text"}],
        findings=[{"id": "sampling_evidence", "claim": "Sampling conditions need an explicit source.",
                   "created_at": "2026-09-10T00:00:00Z", "evidence": [
                       {"artifact": "synthetic_source", "version": 3,
                        "snapshot": "snapshots/synthetic-source-v3.txt",
                        "source_commit": "synthetic-fixture-no-git-commit",
                        "quote": {"exact": "Synthetic quotation for reviewer inspection.",
                                  "prefix": "Synthetic context before.", "suffix": "Synthetic context after."},
                        "location": {"value": "page=7", "page": 7}}]}])
    doc["analyses"].update(second["analyses"])
    doc["outputs"].extend(second["outputs"])
    write_astra_yaml(doc, str(course))
    review = build_review_set(course)
    review["judged_at"] = "2026-09-10T00:00:00Z"
    for verdict in review["scenes"]["s1"]:
        if verdict["verdict"] == "defect":
            verdict["quote"] = "Synthetic quiz accepts answer B."
    review["defects"] = [v for v in review["scenes"]["s1"] if v["verdict"] == "defect"]
    write_review(review, course)
    second_review = copy.deepcopy(review)
    second_review["bundle_id"] = "b2"
    second_review["scenes"] = {"s2": second_review["scenes"].pop("s1")}
    for verdict in second_review["scenes"]["s2"]:
        verdict["scene_id"] = "s2"
    second_review["defects"] = [v for v in second_review["scenes"]["s2"] if v["verdict"] == "defect"]
    second_review["skipped"] = {"synthetic-concept": "No applicable judge dimensions"}
    write_review(second_review, course)


def main() -> int:
    """Write fresh audit fixtures and report the real validator's exit status."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path, help="new, nonexistent output directory")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    complete = out / "courses" / "review-demo"
    _complete_course(complete)
    validation = run_astra_validate(complete)
    (out / "validation.log").write_text(validation.output)
    for name in ("no-review", "partial-course"):
        course = out / "courses" / name
        course.mkdir()
        build_course_set(course)
    (out / "courses" / "partial-course" / "universes" / "broken.yaml").write_text("id: [unclosed")
    for name in ("eval", "validity", "sessions", "analytics"):
        (out / name).mkdir()
    report = {"synthetic": True, "model_calls": 0, "schema_ok": validation.ok,
              "validator_exit": validation.returncode, "course": str(complete)}
    (out / "fixtures.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return validation.returncode


if __name__ == "__main__":
    raise SystemExit(main())
