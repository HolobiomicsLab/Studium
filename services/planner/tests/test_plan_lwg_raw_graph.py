"""GAP #8 fidelity: the RAW LWG graph (GraphBuilder _res.graph — whose edges carry
quality_flags + confidence) must be persisted alongside lwg.indicium.jsonld so the
course audit report can surface which edges are flagged_for_review / ungrounded /
low-confidence (the indicium Claim is extra=forbid, so quality_flags can NOT live in
lwg.indicium.jsonld).

planner_app writes the raw graph to .lwg/<sanitized id>/lwg.graph.json (the dict with
nodes + edges[].{quality_flags,confidence,relation,source,target,astra_insight_ref,
evidence}). This is NOT indicium-constrained (raw internal graph), so quality_flags
are legal there.
"""
import json

from fastapi.testclient import TestClient
import planner_app
from agents.graph_agent import GraphAgent

LWG_GRAPH_JSON = "lwg.graph.json"


def _force_prereq(self, concepts):
    """Force ONE prerequisite_for edge between the two derived concepts. With no
    Perspicacité, the edge grounds via the plan-artifact fallback → it is KEPT with
    quality_flags (flagged_for_review band) + confidence 0.4 — exactly the kind of
    edge a teacher must scrutinize."""
    return [{"source": "concept:obj-1", "target": "concept:obj-2", "rationale": "x"}]


def test_plan_writes_raw_lwg_graph_with_quality_flags(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)
    # planner_app imports GraphAgent locally → patch the class method itself so the
    # build produces a prereq edge carrying quality_flags.
    monkeypatch.setattr(GraphAgent, "propose_prerequisites", _force_prereq)

    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp-raw", "target": "L3"})
    assert resp.status_code == 200

    out = tmp_path / "sp-raw"
    raw_path = out / LWG_GRAPH_JSON
    assert raw_path.exists(), "raw LWG graph must be persisted next to lwg.indicium.jsonld"

    raw = json.loads(raw_path.read_text())
    # raw internal graph shape — NOT a JSON-LD doc
    assert raw["course_id"] == "sp-raw"
    assert isinstance(raw.get("nodes"), list) and raw["nodes"]
    assert isinstance(raw.get("edges"), list) and raw["edges"]

    # the prereq edge carries quality_flags + confidence that the indicium jsonld drops
    flagged = [e for e in raw["edges"] if e.get("quality_flags")]
    assert flagged, "expected at least one edge carrying quality_flags in the raw graph"
    e = flagged[0]
    assert e["relation"] == "prerequisite_for"
    assert e["confidence"] == 0.4
    assert isinstance(e["quality_flags"], list) and e["quality_flags"]


def test_plan_does_not_write_raw_graph_when_build_off(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_LWG_BUILD", raising=False)
    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp-off", "target": "L3"})
    assert resp.status_code == 200
    assert not (tmp_path / "sp-off" / LWG_GRAPH_JSON).exists()
