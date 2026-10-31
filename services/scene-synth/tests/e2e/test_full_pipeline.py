"""E2E pipeline test (A.10): lesson_plan -> orchestrator -> bundler -> ZIP.

Strategy
--------
A true plan→bundle E2E with real LLM is non-deterministic and expensive.
This test instead:

1. Builds a representative ``lesson_plan`` covering all 6 scene types.
2. Wires the real ``SceneSynthOrchestrator`` with a deterministic canned
   LLM client that returns valid JSON per scene type, and a permissive
   critic stub.
3. Runs ``synthesize_lesson`` end-to-end through the actual agents and
   bundler.
4. Validates the produced ZIP: ``lesson.json`` parses against the bundle
   schema and contains all 6 scene types; sidecar ``prov.json`` exists.

The plan, the canned scenes and the two stubs now live in
``services/scene-synth/demo_fresh.py`` and are imported here rather than
duplicated: the same pipeline bakes ``demo-fresh.zip``, the bundle the A.10,
C.8 and M5 harnesses stage and play (INT-STUDIUM-033). Two copies would agree
until someone edited one, and the harness would then be playing a bundle no
test had ever asserted anything about.

The full E2E that includes a running ``planner`` service + tauri runtime
is documented in the handoff (A.10 step 2/3) but requires external
processes; this pytest covers the deterministic Python pipeline.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from demo_fresh import (
    SCENE_FIXTURES,
    CannedLLM,
    PermissiveCritic,
    lesson_plan_six_types,
)
from orchestrator import SceneSynthOrchestrator


@pytest.fixture
def fixture_dir() -> Path:
    return Path(__file__).parent.parent.parent.parent.parent / "fixtures"


def test_six_scene_types_produced_in_bundle(tmp_path, fixture_dir):
    abs_capsule_root = fixture_dir / "m2" / "abs_capsule_minimal"
    assert abs_capsule_root.exists(), "ABS capsule fixture missing"

    orch = SceneSynthOrchestrator(
        llm_client=CannedLLM(SCENE_FIXTURES),
        critic=PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=tmp_path,
    )
    plan = lesson_plan_six_types()

    result = orch.synthesize_lesson(plan, options={"include_critique": True})

    # 5 single-scene outlines + 1 quiz outline expanded to 3 items (product
    # parity with the eval harness) = 8 scenes.
    assert result["scenes_generated"] == 8, result
    assert result["warnings"] == [], result["warnings"]

    bundle_path = Path(result["bundle_uri"].replace("file://", ""))
    assert bundle_path.exists()
    with zipfile.ZipFile(bundle_path) as zf:
        names = set(zf.namelist())
        assert "lesson.json" in names
        assert "prov.json" in names
        lesson = json.loads(zf.read("lesson.json"))
        types_present = {s["type"] for s in lesson["scenes"]}
        assert types_present == {
            "intro",
            "concept",
            "quiz",
            "meta_checkpoint",
            "reproduction",
            "ai_critique",
        }
        quiz_ids = [s["id"] for s in lesson["scenes"] if s["type"] == "quiz"]
        assert len(quiz_ids) == 3, quiz_ids
        assert len(set(quiz_ids)) == 3, quiz_ids


def test_include_critique_false_skips_ai_critique(tmp_path, fixture_dir):
    abs_capsule_root = fixture_dir / "m2" / "abs_capsule_minimal"
    orch = SceneSynthOrchestrator(
        llm_client=CannedLLM(SCENE_FIXTURES),
        critic=PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=tmp_path,
    )
    plan = lesson_plan_six_types()
    result = orch.synthesize_lesson(plan, options={"include_critique": False})
    # 4 single-scene outlines (ai_critique skipped) + 1 quiz outline expanded
    # to 3 items = 7 scenes.
    assert result["scenes_generated"] == 7
    assert any("ai_critique" in w for w in result["warnings"])
    bundle_path = Path(result["bundle_uri"].replace("file://", ""))
    with zipfile.ZipFile(bundle_path) as zf:
        lesson = json.loads(zf.read("lesson.json"))
        types_present = {s["type"] for s in lesson["scenes"]}
        assert "ai_critique" not in types_present


def test_unsupported_scene_type_skipped_with_warning(tmp_path, fixture_dir):
    abs_capsule_root = fixture_dir / "m2" / "abs_capsule_minimal"
    orch = SceneSynthOrchestrator(
        llm_client=CannedLLM(SCENE_FIXTURES),
        critic=PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=tmp_path,
    )
    plan = {
        "id": "demo-broken",
        "title": "Avec scène inconnue",
        "concepts": [{"id": "c1", "title": "Concept 1", "description": "desc", "bloom_level_target": "understand"}],
        "scene_outlines": [
            {"id": "s1", "type": "intro", "title": "ok"},
            {"id": "s2", "type": "unknown_type", "title": "inconnue"},
        ],
    }
    result = orch.synthesize_lesson(plan, options={"include_critique": True})
    assert result["scenes_generated"] == 1
    assert any("unsupported" in w for w in result["warnings"])
