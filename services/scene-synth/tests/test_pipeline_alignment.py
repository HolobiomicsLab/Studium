"""Full-pipeline alignment proof: stub agents + real build_bundle.

Verifies that a plan with concepts (keyed on objective ids) produces a
bundle where scenes have concept_refs == objective_refs and concepts are
round-tripped correctly.

Stub agents return minimal real Pydantic IntroScene objects (required by
build_bundle's _scene_to_dict which calls .model_dump()).
"""
from __future__ import annotations

import json
import sys
import os
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from orchestrator import SceneSynthOrchestrator
from bundler import build_bundle
from scene_synth_schemas import IntroScene


def _read_bundle_lesson_json(uri: str) -> dict:
    """Read lesson.json from the bundle ZIP given a file:// URI."""
    path = Path(uri.removeprefix("file://"))
    with zipfile.ZipFile(path) as zf:
        return json.loads(zf.read("lesson.json"))


class _StubAgent:
    def __init__(self, t):
        self.scene_type = t

    def synthesize(self, outline, context):
        # Return a real Pydantic IntroScene so build_bundle can call .model_dump()
        return IntroScene(
            id=outline["id"],
            type="intro",
            title=outline.get("title", outline["id"]),
            objective_refs=[],   # will be overwritten by orchestrator
            concept_refs=[],     # will be overwritten by orchestrator
            estimated_seconds=0,
            adaptation_hooks=[],
            markdown="x",
        )


def test_planner_plan_produces_valid_aligned_bundle(tmp_path):
    plan = {
        "id": "L1",
        "lesson_id": "L1",
        "title": "T",
        "metadata": {
            "title": "T",
            "target": "L3",
            "duration_minutes": 30,
            "language": "fr",
            "discipline": "x",
        },
        "learning_objectives": [
            {"id": "obj-1", "description": "Understand X", "bloom_level": "understand"}
        ],
        "concepts": [
            {
                "id": "obj-1",
                "title": "Understand X",
                "description": "Understand X",
                "bloom_level_target": "understand",
            }
        ],
        "scene_outlines": [
            {"id": "s1", "type": "intro", "title": "I", "objective_refs": ["obj-1"]}
        ],
        "rules": [],
    }

    # Build orchestrator via __new__ + manual wiring (bypass real ctor deps)
    orch = SceneSynthOrchestrator.__new__(SceneSynthOrchestrator)
    orch.agents = {"intro": _StubAgent("intro")}
    orch.output_dir = tmp_path
    orch.prov_seed = {"agent": "scene-synth", "version": "0.1.0", "validator": "test"}
    orch.bundler_fn = build_bundle

    result = orch.synthesize_lesson(plan, {})
    uri = result["bundle_uri"]
    data = _read_bundle_lesson_json(uri)

    assert [c["id"] for c in data["concepts"]] == ["obj-1"]
    assert data["scenes"][0]["concept_refs"] == ["obj-1"]
