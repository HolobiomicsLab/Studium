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
    CommunicationSimScene,
    ComparisonScene,
    ConceptScene,
    ExplainBackScene,
    IntroScene,
    MetaCheckpointScene,
    PromptPracticeScene,
    QuizScene,
    ReproductionScene,
    SpotTheFlawScene,
    SummaryAuditScene,
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


def test_comparison_scene_minimal():
    raw = {
        "id": "s5",
        "type": "comparison",
        "title": "Cours IA vs enseignant",
        "concept_refs": ["c-remplissage"],
        "prompt": "Relève la valeur ajoutée.",
        "artifact_a": "Cours IA.",
        "artifact_b": "Cours enseignant.",
        "key_points": [{"id": "kp1", "text": "exemple", "cues": ["exemple"]}],
        "model_answer": "L'enseignant ajoute un exemple ancré.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.2, "tone": 0.2},
    }
    scene = ComparisonScene.model_validate(raw)
    assert scene.type == "comparison"
    assert scene.artifact_a == "Cours IA."
    assert scene.key_points[0].cues == ["exemple"]


def test_summary_audit_scene_minimal():
    raw = {
        "id": "s6",
        "type": "summary_audit",
        "title": "Audit du résumé IA",
        "concept_refs": ["c-remplissage"],
        "source_content": "Texte source.",
        "ai_summary": "Résumé qui omet un point.",
        "claims": [{"id": "o1", "text": "omission", "flaws_expected": ["hund"]}],
        "model_correction": "Le résumé omet la règle de Hund.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
    }
    scene = SummaryAuditScene.model_validate(raw)
    assert scene.type == "summary_audit"
    assert len(scene.claims) == 1
    assert scene.ai_summary.startswith("Résumé")


def test_prompt_practice_scene_minimal_starter_optional():
    raw = {
        "id": "s7",
        "type": "prompt_practice",
        "title": "Affine ton prompt",
        "concept_refs": ["c-remplissage"],
        "task": "Rédige un prompt.",
        "key_points": [{"id": "kp1", "text": "consigne", "cues": ["consigne"]}],
        "model_prompt": "Tu es un tuteur. Consigne claire.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.2, "tone": 0.2},
    }
    scene = PromptPracticeScene.model_validate(raw)
    assert scene.type == "prompt_practice"
    assert scene.starter_prompt is None
    scene2 = PromptPracticeScene.model_validate({**raw, "starter_prompt": "Explique Hund."})
    assert scene2.starter_prompt == "Explique Hund."


def test_summary_audit_rejects_empty_flaws_expected():
    raw = {
        "id": "s", "type": "summary_audit", "title": "t", "concept_refs": ["c"],
        "source_content": "s", "ai_summary": "a",
        "claims": [{"id": "o", "text": "t", "flaws_expected": []}],
        "model_correction": "m",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    with pytest.raises(ValidationError):
        SummaryAuditScene.model_validate(raw)


def test_comparison_rejects_empty_cues():
    raw = {
        "id": "s", "type": "comparison", "title": "t", "concept_refs": ["c"],
        "prompt": "p", "artifact_a": "a", "artifact_b": "b",
        "key_points": [{"id": "k", "text": "t", "cues": []}],
        "model_answer": "m",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    with pytest.raises(ValidationError):
        ComparisonScene.model_validate(raw)


def test_communication_sim_scene_minimal():
    raw = {
        "id": "s9",
        "type": "communication_sim",
        "title": "Explique à un·e camarade, sans jargon",
        "concept_refs": ["c-orbitales-formes"],
        "scenario": "Fin du TD ; un·e camarade pas au point te demande de l'aide.",
        "prompt": "Explique-lui pourquoi la 2p a deux lobes, sans jargon.",
        "key_points": [{"id": "kp1", "text": "deux zones", "cues": ["deux zones"]}],
        "model_response": "Imagine deux zones de chaque côté, séparées par un couloir vide.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.2, "tone": 0.2},
    }
    scene = CommunicationSimScene.model_validate(raw)
    assert scene.type == "communication_sim"
    assert scene.scenario.startswith("Fin du TD")
    assert scene.model_response  # reveal field present


def test_communication_sim_rejects_empty_cues():
    raw = {
        "id": "s", "type": "communication_sim", "title": "t", "concept_refs": ["c"],
        "scenario": "s", "prompt": "p",
        "key_points": [{"id": "k", "text": "t", "cues": []}],
        "model_response": "m",
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    with pytest.raises(ValidationError):
        CommunicationSimScene.model_validate(raw)


def test_atomistique_bundle_with_active_learning_scenes(fixture_dir):
    """The authored atomistique-l1 bundle (with spot_the_flaw + explain_back) round-trips."""
    lesson_path = fixture_dir / "atomistique-l1" / "lesson.json"
    raw = json.loads(lesson_path.read_text())
    bundle = Bundle.model_validate(raw)
    types = {s.type for s in bundle.scenes}
    assert "spot_the_flaw" in types
    assert "explain_back" in types
    assert "comparison" in types
    assert "summary_audit" in types
    assert "prompt_practice" in types
    assert "communication_sim" in types


def test_scene_aliases_exist():
    """Smoke test : the 4 existing scene types are also exported."""
    assert IntroScene is not None
    assert ConceptScene is not None
    assert QuizScene is not None
    assert MetaCheckpointScene is not None
