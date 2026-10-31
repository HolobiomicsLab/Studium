from fastapi.testclient import TestClient
from analytics_collector_app import app

client = TestClient(app)


def test_get_concept_mastery_history_requires_token(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get("/metrics/concept-mastery-history?course=c1")
    assert r.status_code == 401


def test_get_concept_mastery_history_token_mismatch(tmp_path, monkeypatch):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get(
        "/metrics/concept-mastery-history?course=c1",
        headers={"X-Course-Token": "other"},
    )
    assert r.status_code == 403


def test_the_route_is_withdrawn_and_names_the_reason(tmp_path, monkeypatch):
    """Replaces `…_empty_returns_empty_dict`, deliberately (INT-STUDIUM-030).

    That test asserted `{"concepts": {}}`, and it was a true statement about a false surface.
    The map is empty for EVERY caller — the snapshots are written by
    `store.process_event_for_mastery` from an event field the strict `TelemetryEvent` schema
    does not declare, so none has ever been written. An empty map on a teacher's page reads as
    "this class has no trajectory", which is a claim about the class rather than about the
    pipeline; and the shape it would fill with is rows keyed by pseudonym, which is a
    per-student report on a class-level path. So the route withholds and says why.
    """
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    r = client.get(
        "/metrics/concept-mastery-history?course=c1",
        headers={"X-Course-Token": "c1"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "unavailable"
    assert "concepts" not in body
    assert "concept_states" in body["reason"], body["reason"]


def test_the_withdrawal_does_not_replace_the_authentication(tmp_path, monkeypatch):
    """A route that refuses everyone is the easiest place to lose an auth check by accident:
    the refusal looks the same whether or not the token was ever examined."""
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    assert client.get("/metrics/concept-mastery-history?course=c1").status_code == 401
    assert client.get(
        "/metrics/concept-mastery-history?course=c1",
        headers={"X-Course-Token": "other"},
    ).status_code == 403
