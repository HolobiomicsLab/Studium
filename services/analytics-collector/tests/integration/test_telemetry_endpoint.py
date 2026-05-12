from fastapi.testclient import TestClient
import json
from pathlib import Path

import pytest


def _event(idx: int) -> dict:
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "scene_entered",
        "scene_id": f"s{idx}",
        "scene_type": "concept",
    }


def test_post_telemetry_writes_jsonl(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.post(
        "/telemetry",
        headers={"X-Course-Token": "course-abc"},
        json={"events": [_event(0), _event(1)]},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 2}
    files = list((tmp_path / "course-abc").glob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["scene_id"] == "s0"


def test_post_telemetry_rejects_missing_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.post("/telemetry", json={"events": [_event(0)]})
    assert r.status_code == 401


def test_post_telemetry_rejects_invalid_event(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.post(
        "/telemetry",
        headers={"X-Course-Token": "course-abc"},
        json={"events": [{"type": "not_a_real_event"}]},
    )
    assert r.status_code == 422
