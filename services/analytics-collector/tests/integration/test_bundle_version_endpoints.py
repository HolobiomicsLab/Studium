"""Integration tests for ?bundle_version= query param on all metrics endpoints (M5.7)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, bundle_version: str, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx % 10}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": bundle_version,
        "client_timestamp": "2026-05-09T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed(tmp_path: Path, course: str, events: list[dict]) -> None:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-09.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n"
    )


BV_A = "1.1:b1@2026-05-08T10:00:00Z"
BV_B = "1.1:b1@2026-05-09T10:00:00Z"


def test_get_progress_with_bundle_version_filter(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    _seed(tmp_path, "course-x", [
        _event(0, BV_A, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(1, BV_A, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(2, BV_B, type="scene_completed", scene_id="s1",
               duration_ms=10, success=False),
    ])
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        f"/metrics/progress?course=course-x&bundle_version={BV_A}",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["scenes"]["s1"]["completion_rate"] == 1.0
    assert body["scenes"]["s1"]["n_learners"] == 2


def test_get_ai_literacy_with_bundle_version_filter(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    # On crée plusieurs sessions/jours pour l'index, sur la bundle_version A.
    events = []
    for day in range(3):
        ts = f"2026-05-{10 + day:02d}T10:00:00Z"
        events.append(_event(
            day, BV_A,
            client_timestamp=ts,
            learner_pseudonym="hmac:la",
            type="critique_submitted", scene_id=f"s{day}",
            llm_score=0.7, completion_rate=0.8,
        ))
    # 1 event sur BV_B qui doit être ignoré avec ?bundle_version=BV_A
    events.append(_event(
        9, BV_B,
        client_timestamp="2026-05-13T10:00:00Z",
        learner_pseudonym="hmac:la",
        type="critique_submitted", scene_id="s_other",
        llm_score=0.1, completion_rate=0.1,
    ))
    _seed(tmp_path, "course-x", events)

    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        f"/metrics/ai-literacy?course=course-x&pseudonyme=hmac:la"
        f"&bundle_version={BV_A}",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    # Sans bundle_version → 4 sessions ; avec BV_A → 3 sessions.
    assert body["n_sessions"] == 3


def test_malformed_bundle_version_empty_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/progress?course=course-x&bundle_version=",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 400


def test_malformed_bundle_version_garbage_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/progress?course=course-x&bundle_version=garbage",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 400


def test_unversioned_sentinel_accepted(tmp_path, monkeypatch):
    """La valeur sentinelle 'unversioned' est acceptée (cible events legacy)."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    # event legacy sans bundle_version
    legacy = {
        "event_id": "01923456-7890-1234-5678-abcdef012340",
        "learner_pseudonym": "hmac:l0",
        "lesson_id": "demo",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "scene_completed",
        "scene_id": "s1",
        "duration_ms": 10,
        "success": True,
    }
    d = tmp_path / "course-x"
    d.mkdir(parents=True)
    (d / "2026-05-09.jsonl").write_text(json.dumps(legacy) + "\n")

    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/progress?course=course-x&bundle_version=unversioned",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    assert r.json()["scenes"]["s1"]["completion_rate"] == 1.0


def test_all_metrics_endpoints_accept_bundle_version_param(tmp_path, monkeypatch):
    """Smoke : tous les endpoints /metrics/* acceptent ?bundle_version=."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    headers = {"X-Course-Token": "course-x"}
    qs = f"course=course-x&bundle_version={BV_A}"
    for path in [
        "/metrics/progress",
        "/metrics/calibration",
        "/metrics/autonomy",
        "/metrics/reasoning",
        "/metrics/ai-audit",
    ]:
        r = client.get(f"{path}?{qs}", headers=headers)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
    r = client.get(
        f"/metrics/ai-literacy?{qs}&pseudonyme=hmac:la",
        headers=headers,
    )
    assert r.status_code == 200
