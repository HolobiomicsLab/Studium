"""TDD round-trip tests for the Pydantic mirror of lesson-bundle-schema.

Covers the 4 existing scene types (intro/concept/quiz/meta_checkpoint) via the
M3 demo fixture, plus the 2 new types introduced in A2 (reproduction,
ai_critique).
"""

import json

import pytest
from pydantic import ValidationError

from scene_synth_schemas import (
    AICritiqueScene,
    Bundle,
    ConceptScene,
    ExplainBackScene,
    IntroScene,
    MetaCheckpointScene,
    QuizScene,
    ReproductionScene,
    SpotTheFlawScene,
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


def test_spot_the_flaw_scene_minimal():
    raw = {
        "id": "s3",
        "type": "spot_the_flaw",
        "title": "Repère l'erreur",
        "concept_refs": ["c-remplissage"],
        "flawed_content": "L'azote est 1s² 2s² 2p⁴ avec électrons appariés.",
        "claims": [{"id": "f1", "text": "config fausse", "flaws_expected": ["hund", "2p3"]}],
        "model_correction": "L'azote est 1s² 2s² 2p³ (règle de Hund).",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
    }
    scene = SpotTheFlawScene.model_validate(raw)
    assert scene.type == "spot_the_flaw"
    assert len(scene.claims) == 1
    assert scene.model_correction.startswith("L'azote est 1s")


def test_explain_back_scene_minimal():
    raw = {
        "id": "s4",
        "type": "explain_back",
        "title": "Explique",
        "concept_refs": ["c-orbitales-formes"],
        "prompt": "Pourquoi la 2p a-t-elle deux lobes ?",
        "key_points": [{"id": "kp1", "text": "fonction d'onde", "cues": ["fonction"]}],
        "model_explanation": "La 2p change de signe : plan nodal.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.2, "tone": 0.2},
    }
    scene = ExplainBackScene.model_validate(raw)
    assert scene.type == "explain_back"
    assert scene.key_points[0].cues == ["fonction"]


def test_spot_the_flaw_rejects_empty_flaws_expected():
    """RC-1: a claim with nothing to spot is invalid (would silently fail every learner offline)."""
    raw = {
        "id": "s", "type": "spot_the_flaw", "title": "t", "concept_refs": ["c"],
        "flawed_content": "x",
        "claims": [{"id": "f", "text": "t", "flaws_expected": []}],
        "model_correction": "y",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    with pytest.raises(ValidationError):
        SpotTheFlawScene.model_validate(raw)


def test_explain_back_rejects_empty_cues():
    """RC-1: a key point with no cues could never be covered, so it is invalid."""
    raw = {
        "id": "s", "type": "explain_back", "title": "t", "concept_refs": ["c"],
        "prompt": "p",
        "key_points": [{"id": "k", "text": "t", "cues": []}],
        "model_explanation": "m",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    with pytest.raises(ValidationError):
        ExplainBackScene.model_validate(raw)


def test_atomistique_bundle_with_active_learning_scenes(fixture_dir):
    """The authored atomistique-l1 bundle (with spot_the_flaw + explain_back) round-trips."""
    lesson_path = fixture_dir / "atomistique-l1" / "lesson.json"
    raw = json.loads(lesson_path.read_text())
    bundle = Bundle.model_validate(raw)
    types = {s.type for s in bundle.scenes}
    assert "spot_the_flaw" in types
    assert "explain_back" in types


def test_scene_aliases_exist():
    """Smoke test : the 4 existing scene types are also exported."""
    assert IntroScene is not None
    assert ConceptScene is not None
    assert QuizScene is not None
    assert MetaCheckpointScene is not None
