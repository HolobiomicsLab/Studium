"""Author-time robustness (Critical #2): the LWG build must VALIDATE before
serialize, and FAIL LOUDLY (log + telemetry marker) instead of silently
swallowing — while still NEVER 500-ing the /plan response.

Behaviours asserted:
  1. Build raises  -> /plan still 200, failure LOGGED + marker emitted, NO
     lwg.indicium.jsonld written.
  2. Build returns an INVALID graph (out-of-vocab / structurally broken) ->
     /plan still 200, failure LOGGED + marker emitted, NO artifacts written
     (the invalid graph is never attached to the lesson_plan nor serialized).
  3. Build returns a VALID graph -> graph is validated, attached, and the
     artifacts ARE written (happy path still works).
"""
import json
import logging

from fastapi.testclient import TestClient
import planner_app
from graph.builder import GraphBuildResult


def _marker_path(out_root, safe_id="sp101"):
    return out_root / safe_id / "lwg_build.telemetry.jsonl"


def _common_env(monkeypatch, tmp_path):
    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)


def test_lwg_build_raises_is_loud_and_skips_write(monkeypatch, tmp_path, caplog):
    _common_env(monkeypatch, tmp_path)

    def _boom(self, plan):  # noqa: ANN001
        raise RuntimeError("synthetic build explosion")

    monkeypatch.setattr("graph.builder.GraphBuilder.build", _boom)

    client = TestClient(planner_app.app)
    with caplog.at_level(logging.ERROR):
        resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})

    # /plan never 500s on an LWG failure.
    assert resp.status_code == 200
    # No invalid artifact written.
    assert not (tmp_path / "sp101" / "lwg.indicium.jsonld").exists()
    # Failure is LOUD: logged at ERROR level.
    assert any(
        rec.levelno >= logging.ERROR and "LWG" in rec.getMessage()
        for rec in caplog.records
    ), [r.getMessage() for r in caplog.records]
    # Failure is OBSERVABLE: a telemetry marker is emitted.
    marker = _marker_path(tmp_path)
    assert marker.exists(), "expected an LWG-failure telemetry marker"
    events = [json.loads(line) for line in marker.read_text().splitlines() if line.strip()]
    assert any(e.get("event") == "lwg_build_failed" for e in events), events


def test_lwg_build_invalid_graph_is_loud_and_skips_write(monkeypatch, tmp_path, caplog):
    _common_env(monkeypatch, tmp_path)

    # An invalid graph: out-of-vocab node_kind / missing required fields.
    bad_graph = {
        "schema_version": "1.0",
        "course_id": "sp101",
        "nodes": [{"id": "n1", "node_kind": "NOT_A_REAL_KIND", "title": "x"}],
        "edges": [],
    }

    def _bad(self, plan):  # noqa: ANN001
        return GraphBuildResult(graph=bad_graph, decisions=[], findings=[], telemetry=[])

    monkeypatch.setattr("graph.builder.GraphBuilder.build", _bad)

    client = TestClient(planner_app.app)
    with caplog.at_level(logging.ERROR):
        resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})

    assert resp.status_code == 200
    # Invalid graph must NOT be serialized.
    assert not (tmp_path / "sp101" / "lwg.indicium.jsonld").exists()
    # And must NOT be attached to the returned lesson_plan.
    body = resp.json()
    assert body["lesson_plan"].get("learning_workflow_graph") is None
    # Loud: ERROR log mentioning LWG.
    assert any(
        rec.levelno >= logging.ERROR and "LWG" in rec.getMessage()
        for rec in caplog.records
    ), [r.getMessage() for r in caplog.records]
    # Observable: telemetry marker with the validation failure.
    marker = _marker_path(tmp_path)
    assert marker.exists()
    events = [json.loads(line) for line in marker.read_text().splitlines() if line.strip()]
    assert any(e.get("event") == "lwg_build_failed" for e in events), events
    # The marker carries the validator errors (not just a bare flag).
    failed = [e for e in events if e.get("event") == "lwg_build_failed"]
    assert any(e.get("errors") for e in failed), failed


def test_lwg_build_valid_graph_is_validated_attached_and_written(monkeypatch, tmp_path):
    _common_env(monkeypatch, tmp_path)

    client = TestClient(planner_app.app)
    resp = client.post("/plan", json={"manifest_id": "sp101", "target": "L3"})
    assert resp.status_code == 200

    # Happy path: artifacts written + graph attached.
    indicium = json.loads((tmp_path / "sp101" / "lwg.indicium.jsonld").read_text())
    assert "@context" in indicium and "@graph" in indicium

    body = resp.json()
    lwg = body["lesson_plan"].get("learning_workflow_graph")
    assert lwg is not None
    assert lwg["schema_version"] == "1.0"

    # No failure marker on the happy path (and if a marker file exists, it must
    # not contain a failure event).
    marker = _marker_path(tmp_path)
    if marker.exists():
        events = [json.loads(line) for line in marker.read_text().splitlines() if line.strip()]
        assert not any(e.get("event") == "lwg_build_failed" for e in events), events
