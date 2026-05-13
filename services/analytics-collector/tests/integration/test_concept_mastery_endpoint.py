from fastapi.testclient import TestClient
from analytics_collector_app import app

client = TestClient(app)


def test_get_concept_mastery_history_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get("/metrics/concept-mastery-history?course=c1")
    assert r.status_code == 401


def test_get_concept_mastery_history_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get(
        "/metrics/concept-mastery-history?course=c1",
        headers={"X-Course-Token": "other"},
    )
    assert r.status_code == 403


def test_get_concept_mastery_history_empty_returns_empty_dict(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get(
        "/metrics/concept-mastery-history?course=c1",
        headers={"X-Course-Token": "c1"},
    )
    assert r.status_code == 200
    assert r.json() == {"concepts": {}}
