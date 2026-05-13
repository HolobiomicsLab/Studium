"""Integration tests for GET /metrics/journal (F1.3, ADR 006 v1.3).

ADR 011-style garde-fou : auth via ``X-Course-Token == course``.
ADR 006 v1.3 strict : counters only, no journal text ever in response.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-13T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed_jsonl(data_dir: Path, course: str, events: list[dict]) -> None:
    d = data_dir / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-13.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n"
    )


def test_get_journal_requires_x_course_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/journal?course=course-x")
    assert r.status_code == 401


def test_get_journal_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/journal?course=course-x",
        headers={"X-Course-Token": "different-course"},
    )
    assert r.status_code == 403


def test_get_journal_empty_returns_zero(tmp_path, monkeypatch):
    """No journal events seeded → response shape filled with zero counters."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    _seed_jsonl(tmp_path, "course-x", [])
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/journal?course=course-x",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["entries_total"] == 0
    assert body["mean_length"] == 0
    assert body["revision_rate"] == 0
    assert body["entries_by_scene"] == {}
