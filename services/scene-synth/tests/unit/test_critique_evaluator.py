"""Tests unitaires de ``CritiqueEvaluator`` (A2 — A.5).

CritiqueEvaluator n'est pas un SceneAgent : il évalue *a posteriori* la
critique étudiante d'une scène ``ai_critique`` et retourne un score + feedback.
Sera exposé par ``/scenes/critique-eval`` en A.7.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from agents.critique_evaluator import CritiqueEvaluator


def test_critique_evaluator_returns_score_and_feedback():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = (
        '{"score": 0.7, "feedback": "Bonne identification du biais sur methodologie."}'
    )
    evaluator = CritiqueEvaluator(llm_client=fake_llm)
    result = evaluator.evaluate(
        claims=[
            {
                "id": "c1",
                "text": "L'auteur omet la methodologie.",
                "flaws_expected": ["bias_omission_methodology"],
            }
        ],
        rubric={"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2},
        student_critique="L'auteur ne mentionne pas la methodologie experimentale.",
    )
    assert 0 <= result.score <= 1
    assert isinstance(result.feedback, str) and len(result.feedback) > 0


def test_critique_evaluator_clips_out_of_range_score():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"score": 1.5, "feedback": "Excellent."}'
    evaluator = CritiqueEvaluator(llm_client=fake_llm)
    result = evaluator.evaluate(
        claims=[],
        rubric={"completeness": 1.0, "evidence_quality": 0.0, "tone": 0.0},
        student_critique="...",
    )
    assert result.score == 1.0  # clipped


def test_critique_evaluator_handles_invalid_llm_response():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = "not json"
    evaluator = CritiqueEvaluator(llm_client=fake_llm)

    import pytest

    with pytest.raises(ValueError):
        evaluator.evaluate(
            claims=[],
            rubric={"completeness": 1.0, "evidence_quality": 0.0, "tone": 0.0},
            student_critique="...",
        )
