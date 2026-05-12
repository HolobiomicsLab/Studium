import json
from pydantic import TypeAdapter
from telemetry_events import TelemetryEvent

adapter = TypeAdapter(TelemetryEvent)


def test_quiz_answered_parses():
    raw = {
        "event_id": "01923456-7890-1234-5678-abcdef012345",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "quiz_answered",
        "scene_id": "s1",
        "item_id": "q1",
        "correct": True,
        "response_time_ms": 1234,
        "confidence": 0.7,
    }
    event = adapter.validate_python(raw)
    assert event.type == "quiz_answered"
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_lesson_started_parses():
    raw = {
        "event_id": "01923456-7890-1234-5678-abcdef012345",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "lesson_started",
        "bundle_uri": "file:///tmp/demo.zip",
    }
    event = adapter.validate_python(raw)
    assert event.type == "lesson_started"


def test_consent_granted_validates_scope():
    raw_ok = {
        "event_id": "01923456-7890-1234-5678-abcdef012345",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "consent_granted",
        "scope": "A",
    }
    event = adapter.validate_python(raw_ok)
    assert event.scope == "A"

    import pytest
    from pydantic import ValidationError
    raw_bad = {**raw_ok, "scope": "Z"}
    with pytest.raises(ValidationError):
        adapter.validate_python(raw_bad)


def test_unknown_type_rejected():
    raw = {
        "event_id": "01923456-7890-1234-5678-abcdef012345",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "not_real",
    }
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)
