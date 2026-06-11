"""End-to-end: POST /plan with STUDIUM_LWG_BUILD=on writes the three LWG artifacts.
Mock LLM (default), no Perspicacité (grounding falls back to the plan)."""
import json
import yaml
from fastapi.testclient import TestClient
import planner_app


def test_plan_writes_lwg_artifacts(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)

    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})
    assert resp.status_code == 200

    out = tmp_path / "sp101"
    indicium = json.loads((out / "lwg.indicium.jsonld").read_text())
    assert "@context" in indicium and "@graph" in indicium

    astra = yaml.safe_load((out / "astra.yaml").read_text())
    assert astra["version"] == "0.0.10"
    assert "prereq_strictness" in astra["decisions"]

    baseline = yaml.safe_load((out / "universes" / "baseline.yaml").read_text())
    remedial = yaml.safe_load((out / "universes" / "remedial.yaml").read_text())
    assert baseline["decisions"]["scaffolding"] == "standard"
    assert remedial["decisions"]["scaffolding"] == "heavy"


def test_plan_lwg_off_by_default(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_LWG_BUILD", raising=False)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})
    assert resp.status_code == 200
    assert not (tmp_path / "sp101").exists()
