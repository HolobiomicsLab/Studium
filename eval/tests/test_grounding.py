"""Unit tests for the harness grounding step (REVIEW-FINDINGS #7 / ADR 014)."""
from __future__ import annotations

import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(EVAL_DIR))
sys.path.insert(0, str(REPO_ROOT / "packages" / "perspicacite-client" / "python"))
sys.path.insert(0, str(REPO_ROOT / "services" / "scene-synth"))

from harness.grounding import ground_bundle  # noqa: E402
from perspicacite_mcp.client import MockPerspicaciteClient  # noqa: E402
from scene_synth_schemas import Evidence  # noqa: E402


def _fixture() -> tuple[list[dict], dict]:
    scenes = [
        {"id": "s-intro", "type": "intro", "title": "Intro", "objective_refs": [],
         "concept_refs": ["c0"], "estimated_seconds": 45, "adaptation_hooks": [], "markdown": "x"},
        {"id": "s-concept-c0", "type": "concept", "title": "Concept 0", "objective_refs": [],
         "concept_refs": ["c0"], "estimated_seconds": 90, "adaptation_hooks": [], "markdown": "y"},
        {"id": "s-quiz", "type": "quiz", "title": "Quiz", "concept_refs": ["c0"]},
    ]
    lwg = {"edges": [
        {"id": "e-prereq-1", "relation": "prerequisite_for", "source": "concept:c1",
         "target": "concept:c0", "confidence": 0.5,
         "quality_flags": ["structural_inference", "ungrounded"]},
    ]}
    return scenes, lwg


def test_ground_bundle_grounds_edges_and_enriches_scenes():
    scenes, lwg = _fixture()
    summary = ground_bundle(scenes, lwg, MockPerspicaciteClient())

    edge = lwg["edges"][0]
    assert edge["evidence"], "edge must carry non-empty evidence"
    assert "ungrounded" not in edge["quality_flags"], "ungrounded flag must be dropped"
    assert summary["edges_grounded"] == 1

    intro = next(s for s in scenes if s["type"] == "intro")
    concept = next(s for s in scenes if s["type"] == "concept")
    quiz = next(s for s in scenes if s["type"] == "quiz")
    assert "evidence" in intro and "evidence" in concept
    assert "evidence" not in quiz, "non-intro/concept scenes are not enriched"
    Evidence.model_validate(intro["evidence"])
    Evidence.model_validate(concept["evidence"])
    assert summary["scenes_enriched"] == 2


def test_ground_bundle_clamps_relevance_score_for_live_passages():
    class _OverScore:
        def search(self, **kw):
            return {"status": "ok", "docs": [
                {"id": "d1", "title": "T", "excerpt": "e", "relevance_score": 1.7},
            ]}

    scenes, lwg = _fixture()
    ground_bundle(scenes, lwg, _OverScore())

    concept = next(s for s in scenes if s["type"] == "concept")
    ref = concept["evidence"]["bibliographic_refs"][0]
    assert ref["relevance_score"] == 1.0, "out-of-range score must be clamped to 1.0"
    Evidence.model_validate(concept["evidence"])


def test_ground_bundle_degraded_client_stays_honest():
    class _Offline:
        def search(self, **kw):
            return {"status": "offline", "docs": []}

    scenes, lwg = _fixture()
    summary = ground_bundle(scenes, lwg, _Offline())
    assert summary["edges_grounded"] == 0 and summary["scenes_enriched"] == 0
    assert "ungrounded" in lwg["edges"][0]["quality_flags"], "honest: still flagged ungrounded"
    assert "evidence" not in scenes[0], "honest: no fake scene evidence"
