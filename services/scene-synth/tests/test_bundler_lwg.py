"""Tests: bundler passes learning_workflow_graph from plan into lesson.json."""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bundler import build_bundle
from scene_synth_schemas import IntroScene


def _scenes() -> list:
    return [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=[],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="hi",
        )
    ]


def _plan(with_lwg: bool) -> dict:
    base = {
        "lesson_id": "lwg-test",
        "plan_id": "plan-lwg-test",
        "title": "LWG Test",
        "metadata": {
            "title": "LWG Test",
            "target": "L3",
            "duration_minutes": 10,
            "language": "fr",
            "discipline": "test",
        },
        "concepts": [
            {
                "id": "c1",
                "title": "Concept 1",
                "description": "A concept.",
                "bloom_level_target": "understand",
            }
        ],
        "rules": [],
    }
    if with_lwg:
        base["learning_workflow_graph"] = {
            "schema_version": "1.0",
            "course_id": "L1",
            "nodes": [
                {
                    "id": "concept:c1",
                    "node_kind": "concept",
                    "title": "C1",
                    "bloom_level": "understand",
                }
            ],
            "edges": [],
        }
    return base


def _read_bundle_lesson_json(uri: str) -> dict:
    """Read lesson.json from the bundle ZIP given a file:// URI."""
    path = Path(uri.removeprefix("file://"))
    with zipfile.ZipFile(path) as zf:
        return json.loads(zf.read("lesson.json"))


_PROV_SEED = {"agent": "scene-synth", "version": "0.1.0", "validator": "test"}


def test_bundle_includes_lwg_when_present(tmp_path):
    uri = build_bundle(_plan(True), _scenes(), tmp_path / "b.zip", _PROV_SEED)
    data = _read_bundle_lesson_json(uri)
    assert data["learning_workflow_graph"]["course_id"] == "L1"


def test_bundle_omits_or_nulls_lwg_when_absent(tmp_path):
    uri = build_bundle(_plan(False), _scenes(), tmp_path / "b.zip", _PROV_SEED)
    data = _read_bundle_lesson_json(uri)
    assert data.get("learning_workflow_graph") is None
