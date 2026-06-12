"""Test: SceneSynthOrchestrator emits N distinct quiz items per quiz outline.

Product parity with the eval harness, which already emits 3 quiz scenes per
concept (distinct ids, identical concept_refs) to feed unseen-item remediation.

Uses stub agents injected via orchestrator.agents dict (bypassing real LLM ctor
args) to avoid jinja2 and LLM dependencies — mirrors
``test_orchestrator_concept_refs.py``.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from orchestrator import SceneSynthOrchestrator


class _StubScene:
    def __init__(self, sid):
        self.id = sid
        self.type = "quiz"
        self.objective_refs = []
        self.concept_refs = []


class _StubAgent:
    def __init__(self, scene_type):
        self.scene_type = scene_type

    def synthesize(self, outline, context):
        # Echo the (possibly per-variant) outline id; the orchestrator is
        # responsible for assigning distinct ids per quiz item.
        return _StubScene(outline.get("id"))


def _run(plan, options=None):
    captured = {}

    def _bundler_fn(*, lesson_plan, scenes, output_path, prov_seed):
        captured["scenes"] = scenes
        return "file://stub"

    orch = SceneSynthOrchestrator.__new__(SceneSynthOrchestrator)
    orch.agents = {t: _StubAgent(t) for t in ["intro", "quiz"]}
    import tempfile
    orch.output_dir = __import__("pathlib").Path(tempfile.mkdtemp())
    orch.prov_seed = {}
    orch.bundler_fn = _bundler_fn

    orch.synthesize_lesson(plan, options or {})
    return captured["scenes"]


def test_quiz_outline_emits_three_distinct_items_for_concept():
    plan = {
        "id": "L1",
        "lesson_id": "L1",
        "scene_outlines": [
            {"id": "s-quiz-c1", "type": "quiz", "title": "Q",
             "objective_refs": ["obj-1"]},
        ],
    }
    scenes = _run(plan)

    quiz_scenes = [s for s in scenes if getattr(s, "type", None) == "quiz"]
    assert len(quiz_scenes) >= 3, (
        f"expected >=3 quiz items for the concept, got {len(quiz_scenes)}"
    )
    # All carry the concept's concept_refs.
    for qs in quiz_scenes:
        assert qs.concept_refs == ["obj-1"]
        assert qs.objective_refs == ["obj-1"]
    # Distinct ids.
    ids = [qs.id for qs in quiz_scenes]
    assert len(set(ids)) == len(ids), f"quiz item ids not distinct: {ids}"


def test_questions_per_concept_option_overrides_count():
    plan = {
        "id": "L1",
        "lesson_id": "L1",
        "scene_outlines": [
            {"id": "s-quiz-c1", "type": "quiz", "title": "Q",
             "objective_refs": ["obj-1", "obj-2"]},
        ],
    }
    scenes = _run(plan, options={"questions_per_concept": 2})
    quiz_scenes = [s for s in scenes if getattr(s, "type", None) == "quiz"]
    assert len(quiz_scenes) == 2
    ids = [qs.id for qs in quiz_scenes]
    assert len(set(ids)) == 2
    for qs in quiz_scenes:
        assert qs.concept_refs == ["obj-1", "obj-2"]
