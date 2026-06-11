"""Tests: /plan response carries learning_workflow_graph when STUDIUM_LWG_BUILD=on."""
from fastapi.testclient import TestClient
import planner_app


def test_plan_response_carries_lwg_when_build_on(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp1", "target": "L3"})
    assert resp.status_code == 200
    lwg = resp.json()["lesson_plan"]["learning_workflow_graph"]
    assert lwg is not None and "nodes" in lwg and lwg["course_id"] == "sp1"


def test_plan_response_no_lwg_when_build_off(monkeypatch, tmp_path):
    monkeypatch.delenv("STUDIUM_LWG_BUILD", raising=False)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp1", "target": "L3"})
    assert resp.status_code == 200
    assert resp.json()["lesson_plan"].get("learning_workflow_graph") is None
