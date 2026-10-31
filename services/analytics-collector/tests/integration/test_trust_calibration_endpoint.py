"""Integration tests for GET /metrics/trust-calibration (judgment-over-artifact surface)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed_jsonl(data_dir: Path, course: str, events: list[dict]) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-06-28.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")


def test_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/trust-calibration?course=course-x")
    assert r.status_code == 401


def test_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/trust-calibration?course=course-x",
        headers={"X-Course-Token": "different-course"},
    )
    assert r.status_code == 403


def test_returns_over_trust_band(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = [
        _event(0, learner_pseudonym="hmac:la", type="ai_audit_result",
               scene_id="s_flaw_1", true_positives=1, false_positives=0,
               planted_errors=3, missed=2),
    ]
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    # No `&learner=` since INT-STUDIUM-030 removed the drill-down. One learner is seeded, so
    # the class aggregate is numerically identical and the band below is unchanged.
    r = client.get(
        "/metrics/trust-calibration?course=course-x",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["band"] == "sur"
    assert abs(body["trust_calibration"] - (2 / 3)) < 1e-9
    assert body["n_audits"] == 1


def test_unmeasured_returns_null(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    _seed_jsonl(tmp_path, "course-x", [
        _event(0, type="scene_entered", scene_id="s1"),
    ])
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/trust-calibration?course=course-x",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["trust_calibration"] is None
    assert body["band"] is None
    assert body["n_audits"] == 0
