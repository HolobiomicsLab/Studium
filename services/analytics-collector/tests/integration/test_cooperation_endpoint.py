"""Integration tests for GET /metrics/cooperation (F2.1, views v0.4).

Cooperative session aggregates. Auth ``X-Course-Token == course`` parity
with other analytics endpoints. M4 runtime deferred — fixtures-based v1.
"""

from fastapi.testclient import TestClient


def test_get_cooperation_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/cooperation?course=c1")
    assert r.status_code == 401


def test_get_cooperation_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/cooperation?course=c1",
        headers={"X-Course-Token": "other"},
    )
    assert r.status_code == 403


def test_get_cooperation_empty_n_sessions_zero(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/cooperation?course=c1",
        headers={"X-Course-Token": "c1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["n_sessions"] == 0
    assert body["convergence_quality"] is None
    assert body["role_coverage_mean"] is None
    assert body["disagreement_productive_ratio"] is None
    assert body["votes_per_session_mean"] == 0
