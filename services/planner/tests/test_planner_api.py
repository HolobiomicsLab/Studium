import sys, os
import importlib.util

_PLANNER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _PLANNER_DIR not in sys.path:
    sys.path.insert(0, _PLANNER_DIR)

import pytest
from fastapi.testclient import TestClient


SAMPLE_REQUEST = {
    "manifest_id": "m-001",
    "target": "L3",
    "duration_minutes": 45,
    "language": "fr",
    "keywords": "metabolomics",
    "corpus_refs": [
        {"ref_id": "ref-1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}
    ],
    "text_preview": "Metabolomics is the study of metabolites.",
}


@pytest.fixture
def client():
    from planner_app import app as _app
    return TestClient(_app)


def test_plan_endpoint_without_model_returns_explicit_503(client, monkeypatch):
    monkeypatch.delenv("STUDIUM_LLM_MODE", raising=False)

    response = client.post("/plan", json=SAMPLE_REQUEST)

    assert response.status_code == 503
    assert response.json() == {"detail": "planner model not configured"}


def test_litellm_failure_never_falls_back_to_unrelated_mock(monkeypatch):
    from agents.base import BaseAgent
    import httpx

    mock_calls = []

    class ProbeAgent(BaseAgent):
        def _mock_response(self, reason: str = "") -> str:
            mock_calls.append(reason)
            return "unrelated mock"

    monkeypatch.setenv("STUDIUM_LLM_MODE", "litellm")

    def fail_request(*args, **kwargs):
        raise httpx.ConnectError("model offline")

    monkeypatch.setattr(httpx, "post", fail_request)

    with pytest.raises(RuntimeError, match="planner model request failed: model offline"):
        ProbeAgent()._call_llm("author this lesson")
    assert mock_calls == []


def test_plan_endpoint_surfaces_configured_model_failure(client, monkeypatch):
    import planner_app

    monkeypatch.setenv("STUDIUM_LLM_MODE", "litellm")

    def fail_generation(*args, **kwargs):
        raise ValueError("model offline")

    monkeypatch.setattr(planner_app._planner, "generate", fail_generation)

    response = client.post("/plan", json=SAMPLE_REQUEST)

    assert response.status_code == 503
    assert response.json() == {"detail": "planner model unavailable"}


def test_plan_endpoint_returns_200(client):
    resp = client.post("/plan", json=SAMPLE_REQUEST)
    assert resp.status_code == 200


def test_plan_endpoint_returns_lesson_plan(client):
    resp = client.post("/plan", json=SAMPLE_REQUEST)
    body = resp.json()
    assert "lesson_plan" in body
    assert "critic_score" in body
    assert "critic_annotations" in body
    plan = body["lesson_plan"]
    assert plan["target"] == "L3"
    assert len(plan["learning_objectives"]) >= 1
    assert len(plan["scene_outlines"]) >= 1


def test_plan_endpoint_critic_score_in_range(client):
    resp = client.post("/plan", json=SAMPLE_REQUEST)
    score = resp.json()["critic_score"]
    assert 0.0 <= score <= 1.0


def test_plan_endpoint_missing_target_returns_422(client):
    bad = {k: v for k, v in SAMPLE_REQUEST.items() if k != "target"}
    resp = client.post("/plan", json=bad)
    assert resp.status_code == 422


import os
from unittest.mock import patch, MagicMock


def test_plan_endpoint_enrichment_off_by_default(monkeypatch):
    """STUDIUM_EVIDENCE_ENRICH absent → pas d'evidence dans la réponse."""
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    from planner_app import app as _app
    client = TestClient(_app)
    response = client.post("/plan", json=SAMPLE_REQUEST)
    assert response.status_code == 200
    plan = response.json()["lesson_plan"]
    for scene in plan["scene_outlines"]:
        assert scene.get("evidence") is None


def test_plan_endpoint_enrichment_on_enriches_eligible_scenes(monkeypatch):
    """STUDIUM_EVIDENCE_ENRICH=on → scènes éligibles ont evidence non-null."""
    monkeypatch.setenv("STUDIUM_EVIDENCE_ENRICH", "on")
    fake_response = {
        "status": "ok",
        "docs": [
            {"id": "d1", "title": "T", "authors": ["A"], "excerpt": "x", "relevance_score": 0.7}
        ],
    }
    with patch("planner_app._get_perspicacite_client") as p:
        client_mock = MagicMock()
        client_mock.search.return_value = fake_response
        p.return_value = client_mock
        from planner_app import app as _app
        client = TestClient(_app)
        response = client.post("/plan", json=SAMPLE_REQUEST)
    assert response.status_code == 200
    plan = response.json()["lesson_plan"]
    eligible = [
        s for s in plan["scene_outlines"]
        if s["type"] in ("intro", "concept", "simulation", "reproduction")
    ]
    assert len(eligible) > 0, "plan a au moins une scène éligible"
    assert any(s.get("evidence") is not None for s in eligible)
