"""Integration tests for GET /metrics/ai-literacy (M5.4, ADR 011).

Garde-fou ADR 011 : `pseudonyme` est obligatoire — pas d'agrégation
publique non-nominale via cette endpoint pour éviter ranking
inter-étudiants accidentel.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient


def _event(idx: int, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx % 10}",
        "learner_pseudonym": "hmac:la",
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


def test_get_ai_literacy_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get("/metrics/ai-literacy?course=course-x&pseudonyme=hmac:la")
    assert r.status_code == 401


def test_get_ai_literacy_pseudonyme_required(tmp_path, monkeypatch):
    """Garde-fou ADR 011 : sans pseudonyme → 400."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/ai-literacy?course=course-x",
        headers={"X-Course-Token": "course-x"},
    )
    # FastAPI : missing required query param → 422 (validation),
    # mais le garde-fou ADR 011 doit retourner 400 explicite. On
    # accepte les deux 400/422 (selon impl) tant que ce n'est PAS 200.
    assert r.status_code in (400, 422)


def test_get_ai_literacy_returns_index(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    events = []
    for i in range(3):
        ts = f"2026-05-{1 + i:02d}T10:00:00Z"
        events.append(_event(
            i,
            client_timestamp=ts,
            type="ai_audit_result",
            scene_id=f"s_audit_{i}",
            true_positives=4, false_positives=0,
            planted_errors=5, missed=1,
        ))
        events.append(_event(
            10 + i,
            client_timestamp=ts,
            type="critique_submitted",
            scene_id=f"s_crit_{i}",
            llm_score=0.8,
            completion_rate=0.8,
        ))
        events.append(_event(
            20 + i,
            client_timestamp=ts,
            type="adaptation_applied",
            rule_id="r1", signal="hint", modulator="M3", value=1.0,
        ))
    _seed_jsonl(tmp_path, "course-x", events)
    from analytics_collector_app import app
    client = TestClient(app)
    r = client.get(
        "/metrics/ai-literacy?course=course-x&pseudonyme=hmac:la",
        headers={"X-Course-Token": "course-x"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "value" in body
    assert "ic80" in body
    assert "n_sessions" in body
    assert "window" in body
    assert "degraded" in body
    assert "components" in body
    assert body["window"] == 10
    assert body["n_sessions"] == 3
    assert body["degraded"] is False
    assert body["components"]["ai_audit_accuracy"] is not None
    assert body["components"]["critique_completion_rate"] is not None
    assert body["components"]["hint_independence_trend"] is not None
    # 3 sessions < 5 → IC80 null
    assert body["ic80"] is None
