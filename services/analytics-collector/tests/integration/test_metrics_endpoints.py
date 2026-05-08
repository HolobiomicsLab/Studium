"""Integration tests for GET /metrics/* endpoints (C.4)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed_jsonl(data_dir: Path, course: str, events: list[dict]) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-09.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n"
    )


def test_get_progress_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    _seed_jsonl(tmp_path, "course-x", [
        _event(0, type="scene_completed", scene_id="s1", duration_ms=1000, success=True),
        _event(1, type="scene_completed", scene_id="s1", duration_ms=900, success=False),
    ])
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/progress?course=course-x", headers={"X-Course-Token": "course-x"})
    assert r.status_code == 200
    body = r.json()
    assert body["scenes"]["s1"]["completion_rate"] == 0.5
    assert body["scenes"]["s1"]["n_learners"] == 2


def test_get_calibration_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = [
        _event(i, learner_pseudonym="hmac:la", type="quiz_answered",
               scene_id="q", item_id=f"i{i}", correct=correct,
               confidence=0.8, response_time_ms=1000)
        for i, correct in enumerate([True, True, True, False])
    ]
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/calibration?course=course-x&learner=hmac:la",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert abs(body["brier_score"] - 0.19) < 0.01
    assert body["n_items"] == 4


def test_get_autonomy_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = [
        _event(0, type="critique_submitted", scene_id="s1", llm_score=0.7, completion_rate=0.8),
        _event(1, type="critique_submitted", scene_id="s2", llm_score=0.6, completion_rate=0.9),
        _event(2, type="adaptation_applied", rule_id="r1", signal="hint",
               modulator="M3", value=1.0),
    ]
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/autonomy?course=course-x", headers={"X-Course-Token": "course-x"})
    assert r.status_code == 200
    body = r.json()
    assert abs(body["critique_completion_rate"] - 0.85) < 0.01
    assert abs(body["autonomy_ratio"] - 0.667) < 0.01
    assert body["n_critique"] == 2
    assert body["n_hints"] == 1


def test_get_progress_rejects_missing_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/progress?course=course-x")
    assert r.status_code == 401


def test_get_progress_rejects_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/progress?course=course-x",
        headers={"X-Course-Token": "different-course"},
    )
    assert r.status_code == 403
