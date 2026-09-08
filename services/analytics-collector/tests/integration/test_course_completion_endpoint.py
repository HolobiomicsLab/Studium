"""Integration tests for GET /metrics/course-completion (class-level course funnel)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _completed(idx: int, lesson: str, pseudo: str) -> dict:
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": lesson,
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
        "type": "lesson_completed",
        "total_duration_ms": 1000,
        "autonomy_ratio": 0.8,
    }


def _seed_jsonl(data_dir: Path, course: str, events: list[dict]) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-06-28.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")


def test_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    assert client.get("/metrics/course-completion?course=c").status_code == 401


def test_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/course-completion?course=c", headers={"X-Course-Token": "other"})
    assert r.status_code == 403


def test_returns_funnel(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    _seed_jsonl(tmp_path, "course-x", [
        _completed(0, "l1", "hmac:a"),
        _completed(1, "l1", "hmac:b"),
        _completed(2, "l2", "hmac:a"),
    ])
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/course-completion?course=course-x", headers={"X-Course-Token": "course-x"})
    assert r.status_code == 200
    body = r.json()
    assert body["lessons"]["l1"]["n_completed"] == 2
    assert body["lessons"]["l2"]["n_completed"] == 1
    assert body["total_completions"] == 3
