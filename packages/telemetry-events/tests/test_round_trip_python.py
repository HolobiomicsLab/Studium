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


BASE = {
    "event_id": "01923456-7890-1234-5678-abcdef012345",
    "learner_pseudonym": "hmac:abc",
    "lesson_id": "demo",
    "bundle_version": "1.0.0",
    "client_timestamp": "2026-05-09T10:00:00Z",
}


def test_reasoning_signal_round_trip():
    raw = {
        **BASE,
        "type": "reasoning_signal",
        "scene_id": "s_discuss_1",
        "signal": "justification",
        "confidence": 0.82,
        "turn_index": 3,
    }
    event = adapter.validate_python(raw)
    assert event.type == "reasoning_signal"
    assert event.signal == "justification"
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_reasoning_signal_all_signal_labels():
    for signal in ["justification", "hypothesis", "question", "counterexample", "synthesis"]:
        raw = {
            **BASE,
            "type": "reasoning_signal",
            "scene_id": "s_d",
            "signal": signal,
            "confidence": 0.5,
            "turn_index": 0,
        }
        event = adapter.validate_python(raw)
        assert event.signal == signal


def test_reasoning_signal_rejects_invalid_signal():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "reasoning_signal",
        "scene_id": "s_d",
        "signal": "nope",
        "confidence": 0.5,
        "turn_index": 0,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_reasoning_signal_rejects_confidence_out_of_range():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "reasoning_signal",
        "scene_id": "s_d",
        "signal": "justification",
        "turn_index": 0,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "confidence": 1.1})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "confidence": -0.01})


def test_reasoning_signal_rejects_negative_turn_index():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "reasoning_signal",
        "scene_id": "s_d",
        "signal": "justification",
        "confidence": 0.5,
        "turn_index": -1,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_reasoning_signal_rejects_missing_field():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "reasoning_signal",
        "scene_id": "s_d",
        "signal": "justification",
        "confidence": 0.5,
        # missing turn_index
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_ai_audit_result_round_trip():
    raw = {
        **BASE,
        "type": "ai_audit_result",
        "scene_id": "s_audit_1",
        "planted_errors": 5,
        "true_positives": 3,
        "false_positives": 1,
        "missed": 2,
    }
    event = adapter.validate_python(raw)
    assert event.type == "ai_audit_result"
    assert event.planted_errors == 5
    assert event.missed == 2
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_ai_audit_result_rejects_negative_counters():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "ai_audit_result",
        "scene_id": "s_a",
        "planted_errors": 5,
        "true_positives": 3,
        "false_positives": 1,
        "missed": 2,
    }
    for field in ["planted_errors", "true_positives", "false_positives", "missed"]:
        with pytest.raises(ValidationError):
            adapter.validate_python({**base, field: -1})


def test_ai_audit_result_rejects_non_integer():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "ai_audit_result",
        "scene_id": "s_a",
        "planted_errors": 5,
        "true_positives": 3.5,
        "false_positives": 1,
        "missed": 2,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_ai_audit_result_rejects_missing_field():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "ai_audit_result",
        "scene_id": "s_a",
        "planted_errors": 5,
        "true_positives": 3,
        "false_positives": 1,
        # missing missed
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)
