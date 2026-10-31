"""Integration tests for bundler.build_bundle (A.6).

Strategy: build a real LessonBundle with the strict schema, write a ZIP
containing lesson.json (validated) + prov.json (PROV-O JSON-LD sidecar),
verify ZIP layout and round-trip.
"""

from __future__ import annotations

import json
import zipfile

from bundler import build_bundle
from scene_synth_schemas import (
    ConceptScene,
    IntroScene,
    LessonBundle,
)


def _make_lesson_plan() -> dict:
    """Plan d'entrée minimal mais conforme au schéma strict."""
    return {
        "lesson_id": "demo-001",
        "plan_id": "plan-demo-001",
        "title": "Démo",
        "version": "1.0.0",
        "metadata": {
            "title": "Démo",
            "target": "L3",
            "duration_minutes": 30,
            "language": "fr",
            "discipline": "test",
        },
        "concepts": [
            {
                "id": "c1",
                "title": "Concept 1",
                "description": "Un concept de test.",
                "bloom_level_target": "understand",
            }
        ],
        "rules": [],
    }


def _make_scenes() -> list:
    return [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=[],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="b",
        ),
        ConceptScene(
            id="s1",
            type="concept",
            title="C",
            objective_refs=[],
            concept_refs=["c1"],
            estimated_seconds=120,
            adaptation_hooks=[],
            markdown="...",
        ),
    ]


def test_build_bundle_produces_valid_zip(tmp_path):
    scenes = _make_scenes()
    lesson_plan = _make_lesson_plan()
    out = tmp_path / "demo.zip"

    bundle_uri = build_bundle(
        lesson_plan=lesson_plan,
        scenes=scenes,
        output_path=out,
        prov_seed={"agent": "scene-synth", "version": "0.1.0"},
    )

    assert out.exists()
    assert bundle_uri == out.as_uri()

    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
        assert "lesson.json" in names
        raw = json.loads(zf.read("lesson.json"))
        # Round-trip strict
        bundle = LessonBundle.model_validate(raw)
        assert len(bundle.scenes) == 2
        assert bundle.bundle_id.endswith("demo-001")
        assert bundle.source_plan_id == "plan-demo-001"
        assert bundle.metadata.title == "Démo"


def test_build_bundle_includes_prov_graph(tmp_path):
    scenes = [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=[],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="b",
        )
    ]
    lesson_plan = _make_lesson_plan()
    out = tmp_path / "demo.zip"
    build_bundle(
        lesson_plan=lesson_plan,
        scenes=scenes,
        output_path=out,
        prov_seed={"agent": "scene-synth", "version": "0.1.0"},
    )

    with zipfile.ZipFile(out) as zf:
        # Sidecar choice : prov est un fichier prov.json séparé.
        assert "prov.json" in zf.namelist()
        prov = json.loads(zf.read("prov.json"))
        assert "@context" in prov
        assert "@graph" in prov
        # Lesson reste validable et n'expose pas prov_graph (schéma strict).
        raw = json.loads(zf.read("lesson.json"))
        LessonBundle.model_validate(raw)
        assert "prov_graph" not in raw


def test_build_bundle_forwards_the_plan_authoring(tmp_path):
    lesson_plan = _make_lesson_plan()
    lesson_plan["metadata"]["authoring"] = {"mode": "self_study", "author_is_learner": True}
    out = tmp_path / "demo.zip"
    build_bundle(
        lesson_plan=lesson_plan,
        scenes=_make_scenes(),
        output_path=out,
        prov_seed={"agent": "scene-synth", "version": "0.1.0"},
    )

    with zipfile.ZipFile(out) as zf:
        raw = json.loads(zf.read("lesson.json"))
    assert raw["metadata"]["authoring"] == {"mode": "self_study", "author_is_learner": True}
    assert LessonBundle.model_validate(raw).metadata.authoring.mode == "self_study"


def test_build_bundle_leaves_authoring_absent_not_null_when_the_plan_has_none(tmp_path):
    # The TS reader declares `authoring` .optional(): absence parses, null does not.
    out = tmp_path / "demo.zip"
    build_bundle(
        lesson_plan=_make_lesson_plan(),
        scenes=_make_scenes(),
        output_path=out,
        prov_seed={"agent": "scene-synth", "version": "0.1.0"},
    )

    with zipfile.ZipFile(out) as zf:
        raw = json.loads(zf.read("lesson.json"))
    assert "authoring" not in raw["metadata"]
