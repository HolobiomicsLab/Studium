"""TDD round-trip tests for the Pydantic mirror of lesson-bundle-schema.

Covers the 4 existing scene types (intro/concept/quiz/meta_checkpoint) via the
M3 demo fixture, plus the 2 new types introduced in A2 (reproduction,
ai_critique).
"""

import json

from scene_synth_schemas import (
    AICritiqueScene,
    Bundle,
    ConceptScene,
    IntroScene,
    MetaCheckpointScene,
    QuizScene,
    ReproductionScene,
)


def test_bundle_round_trip(fixture_dir):
    """The M3 demo lesson.json must parse and re-serialise identically."""
    lesson_path = fixture_dir / "m3" / "demo-metabolomics" / "lesson.json"
    raw = json.loads(lesson_path.read_text())
    bundle = Bundle.model_validate(raw)
    serialized = json.loads(bundle.model_dump_json(exclude_none=True))
    assert serialized == raw


def test_reproduction_scene_minimal():
    raw = {
        "id": "s1",
        "type": "reproduction",
        "title": "Reproduire l'expérience X",
        "task_card_id": "task_001",
        "steps": [
            {
                "step_id": "1",
                "instruction": "Mesurer le pH",
                "expected_input_schema": {"type": "number"},
                "expected_output": "7.4",
            }
        ],
    }
    scene = ReproductionScene.model_validate(raw)
    assert scene.task_card_id == "task_001"
    assert len(scene.steps) == 1


def test_ai_critique_scene_minimal():
    raw = {
        "id": "s2",
        "type": "ai_critique",
        "title": "Critiquer ces affirmations",
        "claims": [
            {"id": "c1", "text": "...", "flaws_expected": ["bias_X"]},
        ],
        "rubric": {
            "completeness": 0.4,
            "evidence_quality": 0.4,
            "tone": 0.2,
        },
    }
    scene = AICritiqueScene.model_validate(raw)
    assert len(scene.claims) == 1
    assert scene.rubric.completeness == 0.4


def test_scene_aliases_exist():
    """Smoke test : the 4 existing scene types are also exported."""
    assert IntroScene is not None
    assert ConceptScene is not None
    assert QuizScene is not None
    assert MetaCheckpointScene is not None
