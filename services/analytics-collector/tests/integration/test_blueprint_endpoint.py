import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from fastapi.testclient import TestClient

from analytics_collector_app import app

client = TestClient(app)

VALID_BODY = {
    "course": "c1",
    "pseudonyme": "pseudo-alice",
    "bundle_version": "1.3:demo@2026-05-13T10:00:00Z",
    "blueprint": {
        "dimensions": [
            {"id": "d1", "label": "D1", "weight": 1.0,
             "metrics": [{"endpoint": "ai_literacy", "field": "value", "weight_in_dimension": 1.0}]},
        ],
    },
}


def test_post_blueprint_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.post("/metrics/blueprint", json=VALID_BODY)
    assert r.status_code == 401


def test_post_blueprint_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.post(
        "/metrics/blueprint",
        json=VALID_BODY,
        headers={"X-Course-Token": "other"},
    )
    assert r.status_code == 403


def test_post_blueprint_empty_data_returns_none_dimensions(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.post(
        "/metrics/blueprint",
        json=VALID_BODY,
        headers={"X-Course-Token": "c1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["dimensions"]) == 1
    assert body["dimensions"][0]["id"] == "d1"
    # No metrics data → score is None
    assert body["overall_weighted_score"] is None
