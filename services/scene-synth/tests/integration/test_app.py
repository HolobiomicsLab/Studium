"""Integration tests for FastAPI app (A.7).

Endpoints under test:
- ``GET  /health``
- ``POST /scenes/synthesize``
- ``POST /scenes/critique-eval``

Tests inject stubs for ``_orchestrator`` and ``_critique_evaluator`` to
avoid hitting a real LLM. The orchestrator path is exercised via a
StubOrch that mimics the public ``synthesize_lesson`` contract.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import scene_synth_app
from agents.base import SceneSynthError


@pytest.fixture
def client(monkeypatch, tmp_path):
    class StubOrch:
        def synthesize_lesson(self, lesson_plan, options):
            return {
                "bundle_uri": (tmp_path / "fake.zip").as_uri(),
                "scenes_generated": 2,
                "prov_graph_nodes": 4,
                "warnings": [],
            }

    monkeypatch.setattr(
        scene_synth_app, "_orchestrator", StubOrch(), raising=False
    )
    return TestClient(scene_synth_app.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_synthesize_returns_bundle_uri(client):
    payload = {
        "lesson_plan": {
            "id": "demo-001",
            "title": "Démo",
            "scene_outlines": [
                {"id": "s0", "type": "intro", "title": "Intro"},
                {"id": "s1", "type": "concept", "title": "Concept"},
            ],
        },
        "options": {"include_critique": True},
    }
    r = client.post("/scenes/synthesize", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bundle_uri"].startswith("file://")
    assert body["scenes_generated"] == 2
    assert body["prov_graph_nodes"] == 4
    assert body["warnings"] == []


def test_synthesize_rejects_invalid_input(client):
    r = client.post("/scenes/synthesize", json={"unknown_field": True})
    assert r.status_code == 422


def test_synthesize_returns_502_on_llm_failure(client, monkeypatch):
    class FailingOrch:
        def synthesize_lesson(self, lesson_plan, options):
            raise SceneSynthError("LLM down")

    monkeypatch.setattr(scene_synth_app, "_orchestrator", FailingOrch())
    payload = {
        "lesson_plan": {
            "id": "x",
            "title": "x",
            "scene_outlines": [{"id": "s0", "type": "intro", "title": "T"}],
        },
        "options": {},
    }
    r = client.post("/scenes/synthesize", json=payload)
    assert r.status_code == 502
    assert "LLM" in r.json()["detail"]


def test_critique_eval_endpoint(client, monkeypatch):
    from agents.critique_evaluator import CritiqueResult

    class StubEval:
        def evaluate(self, claims, rubric, student_critique):
            return CritiqueResult(score=0.7, feedback="Bonne identification.")

    monkeypatch.setattr(
        scene_synth_app, "_critique_evaluator", StubEval(), raising=False
    )
    r = client.post(
        "/scenes/critique-eval",
        json={
            "claims": [
                {"id": "c1", "text": "...", "flaws_expected": ["bias"]}
            ],
            "rubric": {
                "completeness": 0.4,
                "evidence_quality": 0.4,
                "tone": 0.2,
            },
            "student_critique": "L'auteur omet la méthodologie.",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["score"] == 0.7
    assert body["feedback"] == "Bonne identification."
    # a result built without the field is "not measured": the key is absent from the response, so
    # the client never reads it as an LLM judgement that nothing was covered
    assert "covered_ids" not in body


def test_critique_eval_endpoint_returns_the_covered_ids(client, monkeypatch):
    from agents.critique_evaluator import CritiqueResult

    class StubEval:
        def evaluate(self, claims, rubric, student_critique):
            return CritiqueResult(score=0.5, feedback="Un défaut sur deux.", covered_ids=["c1"])

    monkeypatch.setattr(scene_synth_app, "_critique_evaluator", StubEval(), raising=False)
    r = client.post(
        "/scenes/critique-eval",
        json={
            "claims": [
                {"id": "c1", "text": "...", "flaws_expected": ["bias"]},
                {"id": "c2", "text": "...", "flaws_expected": ["bias"]},
            ],
            "rubric": {"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2},
            "student_critique": "L'auteur omet la méthodologie.",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["covered_ids"] == ["c1"]


_CRITIQUE_BODY = {
    "claims": [{"id": "c1", "text": "...", "flaws_expected": ["bias"]}],
    "rubric": {"completeness": 0.4, "evidence_quality": 0.4, "tone": 0.2},
    "student_critique": "L'auteur omet la méthodologie.",
}


def _real_evaluator(monkeypatch, reply: str):
    from unittest.mock import MagicMock

    from agents.critique_evaluator import CritiqueEvaluator

    llm = MagicMock()
    llm.complete.return_value = reply
    monkeypatch.setattr(scene_synth_app, "_critique_evaluator", CritiqueEvaluator(llm_client=llm), raising=False)


def test_critique_eval_endpoint_serves_a_reply_without_covered_ids_as_unmeasured(client, monkeypatch):
    _real_evaluator(monkeypatch, '{"score": 0.6, "feedback": "Bien."}')
    r = client.post("/scenes/critique-eval", json=_CRITIQUE_BODY)
    assert r.status_code == 200, r.text
    assert r.json() == {"score": 0.6, "feedback": "Bien."}  # no covered_ids key, no null


def test_critique_eval_endpoint_serves_an_empty_covered_ids_as_a_measurement(client, monkeypatch):
    _real_evaluator(monkeypatch, '{"score": 0.0, "feedback": "Rien.", "covered_ids": []}')
    r = client.post("/scenes/critique-eval", json=_CRITIQUE_BODY)
    assert r.status_code == 200, r.text
    assert r.json()["covered_ids"] == []


@pytest.mark.parametrize(
    "reply",
    [
        "not json",
        '{"score": 0.6, "feedback": "Bien.", "covered_ids": "c1"}',
        '{"score": 0.6, "feedback": "Bien.", "covered_ids": [1]}',
    ],
)
def test_critique_eval_endpoint_answers_502_not_500_for_an_unusable_judge_reply(client, monkeypatch, reply):
    _real_evaluator(monkeypatch, reply)
    r = client.post("/scenes/critique-eval", json=_CRITIQUE_BODY)
    assert r.status_code == 502, r.text
