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
        '{"score": 0.7, "feedback": "Bonne identification du biais sur methodologie.",'
        ' "covered_ids": ["c1"]}'
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
    fake_llm.complete.return_value = '{"score": 1.5, "feedback": "Excellent.", "covered_ids": []}'
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


# --- covered_ids: which of the request's claims / key points the judge found covered ----------------
# (W3 needs_lead 6). The TS adapter builds the learner's "n/m covered" count from these ids, so they
# must be real ids of THIS request, de-duplicated, and a malformed field must fail loudly (the
# adapter then falls back to keywords) instead of being read as "the judge found nothing covered".
# A field the judge left out is not malformed: it means "not measured" (None), and the score stays.

import json

import pytest

CLAIMS = [
    {"id": "c1", "text": "A.", "flaws_expected": ["f1"]},
    {"id": "c2", "text": "B.", "flaws_expected": ["f2"]},
    {"id": "c3", "text": "C.", "flaws_expected": ["f3"]},
]
RUBRIC = {"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2}


def _evaluate(reply: dict | str):
    fake_llm = MagicMock()
    fake_llm.complete.return_value = reply if isinstance(reply, str) else json.dumps(reply)
    return CritiqueEvaluator(llm_client=fake_llm).evaluate(claims=CLAIMS, rubric=RUBRIC, student_critique="x")


def test_covered_ids_are_the_judged_ids_in_request_order():
    result = _evaluate({"score": 0.6, "feedback": "ok", "covered_ids": ["c3", "c1"]})
    assert result.covered_ids == ["c3", "c1"]


def test_covered_ids_drop_ids_the_request_never_had_and_duplicates():
    result = _evaluate({"score": 0.6, "feedback": "ok", "covered_ids": ["c2", "c9", "c2", "c1"]})
    assert result.covered_ids == ["c2", "c1"]


def test_an_empty_covered_ids_is_a_judgement_that_nothing_was_covered():
    assert _evaluate({"score": 0.0, "feedback": "ok", "covered_ids": []}).covered_ids == []


@pytest.mark.parametrize(
    "reply",
    [
        {"score": 0.5, "feedback": "ok", "covered_ids": None},
        {"score": 0.5, "feedback": "ok", "covered_ids": "c1"},
        {"score": 0.5, "feedback": "ok", "covered_ids": [1, 2]},
        {"score": 0.5, "feedback": "ok", "covered_ids": [["c1"]]},
        {"score": 0.5, "feedback": "ok", "covered_ids": {"c1": True}},
    ],
)
def test_a_malformed_covered_ids_is_refused(reply):
    with pytest.raises(ValueError, match="covered_ids"):
        _evaluate(reply)


def test_a_reply_without_covered_ids_keeps_its_score_and_leaves_the_coverage_unmeasured():
    # missing = the judge did not measure coverage: None, never "[] = nothing covered"; the real
    # score and feedback are kept (the client then counts with keywords for the count only)
    result = _evaluate({"score": 0.6, "feedback": "ok"})
    assert (result.score, result.feedback) == (0.6, "ok")
    assert result.covered_ids is None


def test_the_prompt_asks_for_covered_ids_and_lists_the_claim_ids():
    fake_llm = MagicMock()
    fake_llm.complete.return_value = '{"score": 1, "feedback": "ok", "covered_ids": []}'
    CritiqueEvaluator(llm_client=fake_llm).evaluate(claims=CLAIMS, rubric=RUBRIC, student_critique="x")
    prompt = fake_llm.complete.call_args.args[0]
    assert "covered_ids" in prompt
    assert '"id": "c2"' in prompt
