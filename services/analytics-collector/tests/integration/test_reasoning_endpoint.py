"""Integration tests for GET /metrics/reasoning (M5.2)."""

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


def test_get_reasoning_requires_x_course_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/reasoning?course=course-x")
    assert r.status_code == 401


def test_get_reasoning_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/reasoning?course=course-x",
        headers={"X-Course-Token": "different-course"},
    )
    assert r.status_code == 403


def test_get_reasoning_returns_aggregates(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = [
        _event(0, learner_pseudonym="hmac:la", type="reasoning_signal",
               scene_id="s1", signal="justification",
               confidence=0.9, turn_index=0),
        _event(1, learner_pseudonym="hmac:la", type="reasoning_signal",
               scene_id="s1", signal="hypothesis",
               confidence=0.8, turn_index=1),
        _event(2, learner_pseudonym="hmac:la", type="reasoning_signal",
               scene_id="s1", signal="counterexample",
               confidence=0.7, turn_index=2),
    ]
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    # No `&pseudonyme=` since INT-STUDIUM-030 removed the drill-down. `scene_id` survives — a
    # scene is an artifact scope, not a person. One learner is seeded, so s1's score is unchanged.
    r = client.get(
        "/metrics/reasoning?course=course-x",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    s1 = body["scenes"]["s1"]
    # justification (0.25) + hypothesis (0.20) + counterexample (0.20) = 0.65
    assert abs(s1["score"] - 0.65) < 1e-9
    assert s1["n_signals"] == 3
