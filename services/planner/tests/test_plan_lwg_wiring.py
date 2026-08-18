"""End-to-end: POST /plan with STUDIUM_LWG_BUILD=on writes the three LWG artifacts.
Mock LLM (default), no Perspicacité (grounding falls back to the plan)."""
import json
import yaml
from fastapi.testclient import TestClient
import planner_app
from provenance.astra_contract import ASTRA_SCHEMA_VERSION


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
    assert astra["version"] == ASTRA_SCHEMA_VERSION
    assert "prereq_strictness" in astra["decisions"]

    baseline = yaml.safe_load((out / "universes" / "baseline.yaml").read_text())
    remedial = yaml.safe_load((out / "universes" / "remedial.yaml").read_text())
    assert baseline["decisions"]["scaffolding"] == "standard"
    assert remedial["decisions"]["scaffolding"] == "heavy"


def test_plan_lwg_includes_abs_repro_nodes_when_capsule_ref_present(monkeypatch, tmp_path):
    import os
    from lesson_plan_schema import CorpusRef

    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "abs_capsule")
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)

    _orig = planner_app._planner.generate
    def _gen(manifest, target, **kw):
        plan, audit = _orig(manifest, target, **kw)
        plan.corpus_refs = list(plan.corpus_refs or []) + [
            CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path=fixture)
        ]
        return plan, audit
    monkeypatch.setattr(planner_app._planner, "generate", _gen)

    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp1", "target": "L3"})
    assert resp.status_code == 200

    indicium = json.loads((tmp_path / "sp1" / "lwg.indicium.jsonld").read_text())
    subjects = {n.get("subject") for n in indicium["@graph"] if n.get("@type") == "asb:Claim"}
    assert "task:abs:task_001" in subjects


def test_plan_lwg_off_by_default(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_LWG_BUILD", raising=False)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})
    assert resp.status_code == 200
    assert not (tmp_path / "sp101").exists()


def test_plan_lwg_manifest_id_path_traversal_is_contained(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "../evil", "target": "L3"})
    assert resp.status_code == 200
    # nothing escapes the output root
    assert not (tmp_path.parent / "evil").exists()
    # artifacts land in a sanitized single segment under tmp_path
    written = [p for p in tmp_path.iterdir() if p.is_dir()]
    assert written and all(".." not in p.name and "/" not in p.name for p in written)
