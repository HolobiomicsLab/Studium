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
