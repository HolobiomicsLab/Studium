"""AC-1 (production sprint): a course token is a path segment and must stay one.

The collector files events under ``<ANALYTICS_DATA_DIR>/<course token>/``. The token comes from the
``X-Course-Token`` header, so before this fix ``../escaped`` wrote ``<data>/../escaped/<day>.jsonl``
outside the data directory (observed 2026-10-30 with a TestClient probe)."""
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import store


class _Ev(BaseModel):
    type: str = "scene_entered"


BAD_TOKENS = ["../escaped", "..", ".", "a/b", "a\\b", "/abs", ".hidden", "", "x" * 65, "a b", "a..b", "é"]


@pytest.mark.parametrize("token", BAD_TOKENS)
def test_append_events_rejects_unsafe_token(tmp_path, monkeypatch, token):
    data = tmp_path / "data"
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(data))
    with pytest.raises(store.InvalidCourseToken):
        store.append_events(token, [_Ev()])
    # Nothing was created anywhere under the scratch root.
    assert not (tmp_path / "escaped").exists()
    assert not data.exists() or not any(data.iterdir())


@pytest.mark.parametrize("token", BAD_TOKENS)
def test_readers_reject_unsafe_token(tmp_path, token):
    with pytest.raises(store.InvalidCourseToken):
        store.read_events_for_course(tmp_path, token)
    with pytest.raises(store.InvalidCourseToken):
        store.read_concept_mastery_history(tmp_path, token)


@pytest.mark.parametrize("token", ["course-x", "atomistique-l1", "demo-m6", "e2e-course", "c1", "A_b.c-9", "x" * 64])
def test_legitimate_tokens_still_work(tmp_path, monkeypatch, token):
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(tmp_path))
    assert store.append_events(token, [_Ev()]) == 1
    assert len(store.read_events_for_course(tmp_path, token)) == 1


def test_symlink_inside_data_dir_cannot_escape(tmp_path, monkeypatch):
    data = tmp_path / "data"
    outside = tmp_path / "outside"
    data.mkdir()
    outside.mkdir()
    (data / "sneaky").symlink_to(outside, target_is_directory=True)
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(data))
    with pytest.raises(store.InvalidCourseToken):
        store.append_events("sneaky", [_Ev()])
    assert list(outside.iterdir()) == []


def _event():
    return {
        "event_id": "01923456-7890-1234-5678-abcdef012340",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "scene_entered",
        "scene_id": "s0",
        "scene_type": "concept",
    }


def test_post_telemetry_with_traversal_token_is_400_and_writes_nothing(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(data))
    from analytics_collector_app import app

    client = TestClient(app)
    r = client.post("/telemetry", headers={"X-Course-Token": "../escaped"}, json={"events": [_event()]})
    assert r.status_code == 400, r.text
    assert not (tmp_path / "escaped").exists()


def test_metrics_with_traversal_course_is_400(tmp_path, monkeypatch):
    # An attacker who sets course and token to the same traversal string must not be able to read
    # a sibling directory either.
    data = tmp_path / "data"
    data.mkdir()
    sibling = tmp_path / "escaped"
    sibling.mkdir()
    (sibling / "2026-10-30.jsonl").write_text(json.dumps(_event()) + "\n")
    monkeypatch.setenv("ANALYTICS_DATA_DIR", str(data))
    from analytics_collector_app import app

    client = TestClient(app)
    r = client.get("/metrics/progress", params={"course": "../escaped"}, headers={"X-Course-Token": "../escaped"})
    assert r.status_code == 400, r.text
