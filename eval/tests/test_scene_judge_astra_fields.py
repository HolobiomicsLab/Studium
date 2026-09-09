"""INT-STUDIUM-010 Task 4: the scene-review ASTRA document is in-schema.

The real validator (astra-tools 0.2.17 / astra-spec 0.0.14) rejected the review
document for findings without `created_at`, plain-string quotes (spec:
TextQuoteSelector), evidence without ids and undeclared artifacts. This test pins
the field shape; `test_provenance_astra_validate_cli.py` runs the validator itself.
"""
from __future__ import annotations

import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL_DIR))

from test_scene_judge import QUIZ, FakeLLM  # noqa: E402  (pytest prepends eval/tests; not a package)
from harness.paths import ensure_planner_importable  # noqa: E402
from harness.scene_judge import corrupt_scene, emit_review_astra, judge_bundle  # noqa: E402

ensure_planner_importable()
from provenance.astra_emit import analysis_body  # noqa: E402

_AT = "2026-09-03T00:00:00+00:00"


def test_review_findings_are_in_schema():
    corrupted = corrupt_scene(QUIZ)  # (scene, what was corrupted) or None
    assert corrupted is not None
    bundle = {"bundle_id": "b1", "language": "fr", "scenes": [corrupted[0]]}
    review = judge_bundle(bundle, FakeLLM())
    doc = emit_review_astra(review, created_at=_AT)
    slug, body = analysis_body(doc)
    assert body["findings"], "the corrupted scene must produce at least one defect finding"
    declared = {o["id"] for o in body["outputs"]}
    for finding in body["findings"].values():
        assert finding["created_at"] == _AT
        assert finding["evidence"]
        for ev in finding["evidence"]:
            assert ev["id"]
            assert ev["artifact"] in declared
            if "quote" in ev:
                assert isinstance(ev["quote"], dict) and isinstance(ev["quote"]["exact"], str)
    assert body["inputs"][0]["id"] == "lesson_bundle"
    verdicts = next(o for o in body["outputs"] if o["id"] == "verdicts")
    assert verdicts["format"] == "json"
    assert "lesson.json#" not in declared  # raw refs live in grounding-output descriptions


def test_a_review_carries_one_stamp_and_every_emission_reuses_it():
    """INT-STUDIUM-010 nit 2. `created_at` used to default to the wall clock AT EMISSION, so
    `verdicts.json` and `review/astra.yaml` named two different instants and two
    `write_review` calls on the same review produced two different documents. A review that
    becomes an evaluation artifact has to be tied to one moment, and the moment that means
    something is when the judging happened — not when a file was rewritten."""
    # The CORRUPTED scene, so the document actually has findings to carry a stamp. On the
    # clean quiz there are none, `created_at` appears nowhere, and the equality below would
    # hold whatever the code did — a green test measuring an absent field.
    corrupted = corrupt_scene(QUIZ)
    assert corrupted is not None
    bundle = {"bundle_id": "b1", "language": "fr", "scenes": [corrupted[0]]}
    review = judge_bundle(bundle, FakeLLM())
    assert review["judged_at"], "the review must stamp itself"

    first = emit_review_astra(review)
    second = emit_review_astra(review)
    assert first == second
    findings = analysis_body(first)[1]["findings"]
    assert findings, "the corrupted scene must produce at least one defect finding"
    assert {f["created_at"] for f in findings.values()} == {review["judged_at"]}

    # The explicit argument still wins: a caller re-emitting a historical review can pin it.
    pinned = emit_review_astra(review, created_at=_AT)
    for finding in analysis_body(pinned)[1]["findings"].values():
        assert finding["created_at"] == _AT

    # And a review dict written before `judged_at` existed still emits, from the clock.
    legacy = {k: v for k, v in review.items() if k != "judged_at"}
    assert emit_review_astra(legacy)
