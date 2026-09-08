import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import logging

import pytest
from planner_schemas import LessonPlan


SAMPLE_PLAN = LessonPlan(
    id="p-001",
    title="Introduction à la métabolomique",
    language="fr",
    target="L3",
    duration_minutes=45,
    learning_objectives=[
        {"id": "obj-1", "description": "Comprendre les fondements", "bloom_level": "understand"}
    ],
    scene_outlines=[
        {"id": "sc-1", "type": "intro", "title": "Intro", "objective_refs": ["obj-1"]},
        {"id": "sc-2", "type": "quiz", "title": "Quiz", "objective_refs": ["obj-1"]},
    ],
    corpus_refs=[{"ref_id": "r1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}],
    status="draft",
)


def test_review_returns_score_and_annotations():
    from critic import review
    result = review(SAMPLE_PLAN)
    assert "score" in result
    assert "annotations" in result
    assert isinstance(result["score"], float)
    assert isinstance(result["annotations"], list)


def test_review_score_in_range():
    from critic import review
    result = review(SAMPLE_PLAN)
    assert 0.0 <= result["score"] <= 1.0


def test_review_updates_plan_status():
    from critic import review
    result = review(SAMPLE_PLAN)
    # critic should NOT mutate input plan — it returns a dict
    assert SAMPLE_PLAN.status == "draft"
    assert "score" in result


# --- live-mode regressions: a failed LLM call must never be answered by the mock ---

def _refuse_connection(*args, **kwargs):
    raise RuntimeError("connection refused")


class _FakeLiveResponse:
    """Minimal httpx.Response stand-in returning one valid critic verdict."""

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        content = json.dumps({"score": 0.42, "annotations": ["verdict live"]})
        return {"choices": [{"message": {"content": content}}]}


def test_live_failure_never_falls_back_to_the_mock(monkeypatch):
    import critic
    called = []
    monkeypatch.setattr(critic, "_LLM_MODE", "litellm")
    monkeypatch.setattr("httpx.post", _refuse_connection)
    monkeypatch.setattr(critic, "_mock_critic_response", lambda: called.append(1))
    with pytest.raises(ValueError):
        critic.review(SAMPLE_PLAN)
    assert called == []


def test_live_failure_is_logged_on_every_attempt(monkeypatch, caplog):
    import critic
    monkeypatch.setattr(critic, "_LLM_MODE", "litellm")
    monkeypatch.setattr("httpx.post", _refuse_connection)
    with caplog.at_level(logging.ERROR, logger="critic"):
        with pytest.raises(ValueError) as exc:
            critic.review(SAMPLE_PLAN)
    assert "connection refused" in str(exc.value)
    assert len([r for r in caplog.records if r.levelno == logging.ERROR]) == 3


def test_mock_verdict_is_stamped_as_mock(monkeypatch):
    import critic
    monkeypatch.setattr(critic, "_LLM_MODE", "mock")
    result = critic.review(SAMPLE_PLAN)
    assert result["is_mock"] is True


def test_live_verdict_is_not_stamped_as_mock(monkeypatch):
    import critic
    monkeypatch.setattr(critic, "_LLM_MODE", "litellm")
    monkeypatch.setattr("httpx.post", lambda *a, **k: _FakeLiveResponse())
    result = critic.review(SAMPLE_PLAN)
    assert result["score"] == pytest.approx(0.42)
    assert result["is_mock"] is False
