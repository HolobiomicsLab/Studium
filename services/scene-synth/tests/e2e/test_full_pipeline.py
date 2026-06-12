"""E2E pipeline test (A.10): lesson_plan -> orchestrator -> bundler -> ZIP.

Strategy
--------
A true plan→bundle E2E with real LLM is non-deterministic and expensive.
This test instead:

1. Builds a representative ``lesson_plan`` covering all 6 scene types.
2. Wires the real ``SceneSynthOrchestrator`` with a deterministic fake
   LLM client that returns valid JSON per scene type, and a permissive
   critic stub.
3. Runs ``synthesize_lesson`` end-to-end through the actual agents and
   bundler.
4. Validates the produced ZIP: ``lesson.json`` parses against the bundle
   schema and contains all 6 scene types; sidecar ``prov.json`` exists.

The full E2E that includes a running ``planner`` service + tauri runtime
is documented in the handoff (A.10 step 2/3) but requires external
processes; this pytest covers the deterministic Python pipeline.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from agents.critique_evaluator import CritiqueResult
from orchestrator import SceneSynthOrchestrator


SCENE_FIXTURES: dict[str, str] = {
    "intro": json.dumps(
        {
            "id": "s_intro_1",
            "type": "intro",
            "title": "Introduction au sujet",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 60,
            "adaptation_hooks": [],
            "markdown": "Bienvenue dans cette leçon.",
        }
    ),
    "concept": json.dumps(
        {
            "id": "s_concept_1",
            "type": "concept",
            "title": "Concept principal",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 180,
            "adaptation_hooks": [],
            "markdown": "Le concept est défini comme suit...",
        }
    ),
    "quiz": json.dumps(
        {
            "id": "s_quiz_1",
            "type": "quiz",
            "title": "Vérifions",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 90,
            "adaptation_hooks": [],
            "question": "Lequel décrit le mieux X ?",
            "choices": [
                {"id": "a", "text": "Option A", "correct": True},
                {"id": "b", "text": "Option B", "correct": False},
            ],
            "feedback_correct": "Bien.",
            "feedback_incorrect": "Pas exactement, voici pourquoi…",
            "hints": ["Pensez à la définition vue plus haut."],
        }
    ),
    "meta_checkpoint": json.dumps(
        {
            "id": "s_meta_1",
            "type": "meta_checkpoint",
            "title": "Checkpoint méta",
            "objective_refs": ["o1"],
            "concept_refs": ["c1"],
            "estimated_seconds": 60,
            "adaptation_hooks": [],
            "pre_question": "Quelle est votre confiance ?",
            "post_question": "Et après cette section ?",
            "scale_labels": ["aucune", "faible", "moyenne", "bonne", "haute"],
        }
    ),
    "reproduction": json.dumps(
        {
            "id": "s_repro_1",
            "type": "reproduction",
            "title": "Reproduction de la tâche",
            "objective_refs": ["o2"],
            "concept_refs": ["c2"],
            "estimated_seconds": 240,
            "adaptation_hooks": [],
            "task_card_id": "task_001",
            "steps": [
                {
                    "step_id": "1",
                    "instruction": "Charger le fichier mzML",
                    "expected_input_schema": {"type": "string"},
                    "expected_output": "ok",
                }
            ],
        }
    ),
    "ai_critique": json.dumps(
        {
            "id": "s_critique_1",
            "type": "ai_critique",
            "title": "Critique du raisonnement",
            "objective_refs": ["o3"],
            "concept_refs": ["c3"],
            "estimated_seconds": 240,
            "adaptation_hooks": [],
            "claims": [
                {
                    "id": "claim_1",
                    "text": "Affirmation à critiquer",
                    "flaws_expected": ["bias_oversimplification"],
                }
            ],
            "rubric": {
                "completeness": 0.4,
                "evidence_quality": 0.4,
                "tone": 0.2,
            },
        }
    ),
}


class _FakeLLM:
    """Returns canned JSON keyed on a unique signature in each prompt template.

    Each prompt template has a unique header sentence; we match on that to
    avoid false positives (e.g. the quiz prompt mentions ``concept_id``).
    """

    SIGNATURES: list[tuple[str, str]] = [
        ("scène ``concept``", "concept"),
        ("scène ``quiz``", "quiz"),
        ("scène ``meta_checkpoint``", "meta_checkpoint"),
        ("scène d'introduction", "intro"),
        ("scène de reproduction expérimentale", "reproduction"),
        ("scène de critique pédagogique", "ai_critique"),
    ]

    def __init__(self, fixtures: dict[str, str]):
        self.fixtures = fixtures
        self.calls: list[tuple[str, str]] = []

    def complete(self, prompt: str) -> str:
        for needle, stype in self.SIGNATURES:
            if needle in prompt:
                self.calls.append((stype, prompt[:80]))
                return self.fixtures[stype]
        raise AssertionError(
            f"FakeLLM: no signature matched prompt: {prompt[:200]!r}"
        )


class _PermissiveCritic:
    def review(self, scene, plan_section):
        class _R:
            passed = True
            feedback = ""
        return _R()


@pytest.fixture
def fixture_dir() -> Path:
    return Path(__file__).parent.parent.parent.parent.parent / "fixtures"


def _lesson_plan_six_types() -> dict:
    return {
        "id": "demo-e2e",
        "title": "E2E Test Lesson",
        "concepts": [
            {"id": "c1", "title": "Concept 1", "description": "desc", "bloom_level_target": "understand"},
            {"id": "c2", "title": "Concept 2", "description": "desc", "bloom_level_target": "apply"},
            {"id": "c3", "title": "Concept 3", "description": "desc", "bloom_level_target": "analyze"},
        ],
        "scene_outlines": [
            {
                "id": f"s_{stype}_outline",
                "type": stype,
                "title": f"Outline {stype}",
                **(
                    {"abs_task_card_id": "task_001"}
                    if stype == "reproduction"
                    else {}
                ),
            }
            for stype in [
                "intro",
                "concept",
                "quiz",
                "meta_checkpoint",
                "reproduction",
                "ai_critique",
            ]
        ],
    }


def test_six_scene_types_produced_in_bundle(tmp_path, fixture_dir):
    abs_capsule_root = fixture_dir / "m2" / "abs_capsule_minimal"
    assert abs_capsule_root.exists(), "ABS capsule fixture missing"

    orch = SceneSynthOrchestrator(
        llm_client=_FakeLLM(SCENE_FIXTURES),
        critic=_PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=tmp_path,
    )
    plan = _lesson_plan_six_types()

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
        llm_client=_FakeLLM(SCENE_FIXTURES),
        critic=_PermissiveCritic(),
        abs_capsule_root=abs_capsule_root,
        output_dir=tmp_path,
    )
    plan = _lesson_plan_six_types()
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
        llm_client=_FakeLLM(SCENE_FIXTURES),
        critic=_PermissiveCritic(),
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
