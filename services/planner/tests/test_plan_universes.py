from fastapi.testclient import TestClient
import planner_app


def test_plan_carries_universes_when_build_on(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)
    resp = TestClient(planner_app.app).post("/plan", json={"manifest_id": "sp1", "target": "L3"})
    assert resp.status_code == 200
    u = resp.json()["lesson_plan"]["universes"]
    assert u["active"] == "baseline"
    ids = {v["id"] for v in u["variants"]}
    assert ids == {"baseline", "remedial"}
    remedial = next(v for v in u["variants"] if v["id"] == "remedial")
    assert remedial["decisions"]["prereq_strictness"] == "lenient"


def test_plan_no_universes_when_build_off(monkeypatch):
    monkeypatch.delenv("STUDIUM_LWG_BUILD", raising=False)
    resp = TestClient(planner_app.app).post("/plan", json={"manifest_id": "sp1", "target": "L3"})
    assert resp.status_code == 200
    assert resp.json()["lesson_plan"].get("universes") is None
