"""Integration tests for GET /metrics/ai-audit (M5.3)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-12T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed_jsonl(data_dir: Path, course: str, events: list[dict]) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-12.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n"
    )


def test_get_ai_audit_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/ai-audit?course=course-x")
    assert r.status_code == 401


def test_get_ai_audit_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/ai-audit?course=course-x",
        headers={"X-Course-Token": "different-course"},
    )
    assert r.status_code == 403


def test_get_ai_audit_returns_aggregates(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = [
        _event(0, learner_pseudonym="hmac:la", type="ai_audit_result",
               scene_id="s_critique_1",
               true_positives=2, false_positives=1,
               planted_errors=3, missed=1),
        _event(1, learner_pseudonym="hmac:la", type="ai_audit_result",
               scene_id="s_critique_2",
               true_positives=4, false_positives=0,
               planted_errors=4, missed=0),
    ]
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/ai-audit?course=course-x&pseudonyme=hmac:la",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["n_scenes"] == 2
    # overall = mean(1/3, 1.0) = 2/3
    assert abs(body["overall_accuracy"] - ((1 / 3) + 1.0) / 2) < 1e-9
    by_scene = {s["scene_id"]: s for s in body["per_scene"]}
    assert abs(by_scene["s_critique_1"]["accuracy"] - (1 / 3)) < 1e-9
    assert by_scene["s_critique_2"]["accuracy"] == 1.0
