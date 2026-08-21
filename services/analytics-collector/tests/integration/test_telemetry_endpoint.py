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


def test_post_telemetry_accepts_the_runtime_event_types_the_union_once_missed(tmp_path, monkeypatch):
    """hint_requested / universe_selected / tutor_move ARE emitted by the runtime but were
    absent from the Pydantic union, so the collector 422-rejected them at ingest while the
    Zod side validated them fine. Pinned by the schema-parity gate
    (packages/telemetry-events/tests/test_contract_parity.py); this is the endpoint-level proof."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    base = {k: v for k, v in _event(0).items() if k not in ("type", "scene_id", "scene_type")}
    events = [
        {**base, "type": "hint_requested", "scene_id": "s1", "hint_index": 0},
        {**base, "type": "universe_selected", "universe_id": "remedial",
         "active_decisions": {"scaffolding": "heavy"}},
        {**base, "type": "tutor_move", "scene_id": "s2", "move_kind": "invite_test",
         "in_reply_to_signal": "hypothesis", "revealed": False, "reveal_blocked": False,
         "turn_index": 1},
    ]
    r = client.post("/telemetry", headers={"X-Course-Token": "course-abc"}, json={"events": events})
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 3}
