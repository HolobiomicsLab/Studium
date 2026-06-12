"""Test: SceneSynthOrchestrator sets objective_refs + concept_refs on synthesized scenes.

Uses stub agents injected via orchestrator.agents dict (bypassing real LLM ctor args)
to avoid jinja2 and LLM dependencies.
"""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from orchestrator import SceneSynthOrchestrator


class _StubScene:
    def __init__(self, sid):
        self.id = sid
        self.objective_refs = []
        self.concept_refs = []


class _StubAgent:
    def __init__(self, scene_type):
        self.scene_type = scene_type

    def synthesize(self, outline, context):
        return _StubScene(outline["id"])


def test_synthesized_scene_concept_refs_equal_objective_refs(tmp_path):
    captured = {}

    def _bundler_fn(*, lesson_plan, scenes, output_path, prov_seed):
        captured["scenes"] = scenes
        return "file://stub"

    # Build orchestrator with stub internals (bypass real ctor by post-patching agents)
    orch = SceneSynthOrchestrator.__new__(SceneSynthOrchestrator)
    orch.agents = {t: _StubAgent(t) for t in ["intro", "quiz"]}
    orch.output_dir = tmp_path
    orch.prov_seed = {}
    orch.bundler_fn = _bundler_fn

    plan = {
        "id": "L1",
        "lesson_id": "L1",
        "scene_outlines": [
            {"id": "s1", "type": "intro", "title": "I", "objective_refs": ["obj-1"]},
            {"id": "s2", "type": "quiz",  "title": "Q", "objective_refs": ["obj-1", "obj-2"]},
        ],
    }
    orch.synthesize_lesson(plan, {})

    by_id = {s.id: s for s in captured["scenes"]}
    assert by_id["s1"].objective_refs == ["obj-1"]
    assert by_id["s1"].concept_refs == ["obj-1"]
    # The quiz outline ``s2`` now expands to N=3 distinct quiz items
    # (``s2-1``..``s2-3``), each carrying the concept's concept_refs.
    # Product parity with the eval harness — see test_orchestrator_multi_quiz.
    quiz_items = [s for s in captured["scenes"] if s.id.startswith("s2-")]
    assert len(quiz_items) == 3
    for qs in quiz_items:
        assert qs.concept_refs == ["obj-1", "obj-2"]
