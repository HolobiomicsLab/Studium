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


# --- M5.7 — bundle_version is optional with default "unversioned" --------

def test_bundle_version_round_trip():
    """Roundtrip vérifie que le champ bundle_version est préservé."""
    raw = {
        **BASE,
        "bundle_version": "1.1:demo-metabolomics-001@2026-05-08T10:00:00Z",
        "type": "lesson_started",
        "bundle_uri": "file:///tmp/demo.zip",
    }
    event = adapter.validate_python(raw)
    assert event.bundle_version == "1.1:demo-metabolomics-001@2026-05-08T10:00:00Z"
    redumped = json.loads(adapter.dump_json(event))
    assert redumped["bundle_version"] == raw["bundle_version"]


def test_bundle_version_optional_defaults_to_unversioned():
    """Rétro-compat (M5.7) : event ingéré sans bundle_version → "unversioned"."""
    raw = {
        "event_id": "01923456-7890-1234-5678-abcdef012345",
        "learner_pseudonym": "hmac:abc",
        "lesson_id": "demo",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "lesson_started",
        "bundle_uri": "file:///tmp/demo.zip",
        # no bundle_version
    }
    event = adapter.validate_python(raw)
    assert event.bundle_version == "unversioned"


# --- v0.4 — journal_entry_submitted ------------------------------------------

def test_journal_entry_submitted_round_trip():
    raw = {
        **BASE,
        "type": "journal_entry_submitted",
        "scene_id": "s_journal_1",
        "entry_length": 420,
        "revision_count": 1,
        "is_revision": True,
    }
    event = adapter.validate_python(raw)
    assert event.type == "journal_entry_submitted"
    assert event.entry_length == 420
    assert event.revision_count == 1
    assert event.is_revision is True
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_journal_entry_submitted_rejects_negative_entry_length():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "journal_entry_submitted",
        "scene_id": "s_j",
        "entry_length": -1,
        "revision_count": 0,
        "is_revision": False,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_journal_entry_submitted_rejects_negative_revision_count():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "journal_entry_submitted",
        "scene_id": "s_j",
        "entry_length": 100,
        "revision_count": -1,
        "is_revision": False,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_journal_entry_submitted_rejects_non_integer_counters():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "journal_entry_submitted",
        "scene_id": "s_j",
        "is_revision": False,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "entry_length": 1.5, "revision_count": 0})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "entry_length": 0, "revision_count": 1.5})


def test_journal_entry_submitted_rejects_missing_field():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "journal_entry_submitted",
        "scene_id": "s_j",
        "entry_length": 100,
        "revision_count": 0,
        # missing is_revision
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


# --- v0.4 — cooperative_vote -------------------------------------------------

def test_cooperative_vote_round_trip():
    raw = {
        **BASE,
        "type": "cooperative_vote",
        "question_id": "q_vote_1",
        "group_size": 4,
        "aggregate_only": True,
    }
    event = adapter.validate_python(raw)
    assert event.type == "cooperative_vote"
    assert event.group_size == 4
    assert event.aggregate_only is True
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_cooperative_vote_group_size_boundaries():
    for gs in [2, 6]:
        raw = {
            **BASE,
            "type": "cooperative_vote",
            "question_id": "q",
            "group_size": gs,
            "aggregate_only": True,
        }
        event = adapter.validate_python(raw)
        assert event.group_size == gs


def test_cooperative_vote_rejects_group_size_out_of_range():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "cooperative_vote",
        "question_id": "q",
        "aggregate_only": True,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "group_size": 1})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "group_size": 7})


def test_cooperative_vote_rejects_non_integer_group_size():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "cooperative_vote",
        "question_id": "q",
        "group_size": 3.5,
        "aggregate_only": True,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_cooperative_vote_rejects_missing_field():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "cooperative_vote",
        "group_size": 4,
        "aggregate_only": True,
        # missing question_id
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


# --- v0.4 — cooperative_convergence ------------------------------------------

def test_cooperative_convergence_round_trip():
    raw = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn_1",
        "group_size": 4,
        "confidence_distribution_aggregated": [0, 1, 2, 1, 0],
        "role_coverage": 0.75,
    }
    event = adapter.validate_python(raw)
    assert event.type == "cooperative_convergence"
    assert len(event.confidence_distribution_aggregated) == 5
    assert event.role_coverage == 0.75
    redumped = json.loads(adapter.dump_json(event))
    assert redumped == raw


def test_cooperative_convergence_rejects_group_size_out_of_range():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn",
        "confidence_distribution_aggregated": [0, 0, 0, 0, 0],
        "role_coverage": 0.5,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "group_size": 1})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "group_size": 7})


def test_cooperative_convergence_rejects_distribution_wrong_length():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn",
        "group_size": 4,
        "role_coverage": 0.5,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "confidence_distribution_aggregated": [0, 1, 2, 1]})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "confidence_distribution_aggregated": [0, 1, 2, 1, 0, 0]})


def test_cooperative_convergence_rejects_negative_distribution_values():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn",
        "group_size": 4,
        "confidence_distribution_aggregated": [0, 1, -1, 1, 0],
        "role_coverage": 0.5,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_cooperative_convergence_rejects_non_integer_distribution_values():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn",
        "group_size": 4,
        "confidence_distribution_aggregated": [0, 1, 1.5, 1, 0],
        "role_coverage": 0.5,
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


def test_cooperative_convergence_rejects_role_coverage_out_of_range():
    import pytest
    from pydantic import ValidationError
    base = {
        **BASE,
        "type": "cooperative_convergence",
        "synthesis_id": "syn",
        "group_size": 4,
        "confidence_distribution_aggregated": [0, 0, 0, 0, 0],
    }
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "role_coverage": 1.1})
    with pytest.raises(ValidationError):
        adapter.validate_python({**base, "role_coverage": -0.1})


def test_cooperative_convergence_rejects_missing_field():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "cooperative_convergence",
        "group_size": 4,
        "confidence_distribution_aggregated": [0, 0, 0, 0, 0],
        "role_coverage": 0.5,
        # missing synthesis_id
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)


# --- v0.5 — critique_submitted scene_type (RC-2) -----------------------------

def test_critique_submitted_untagged_round_trip():
    """Legacy back-compat: scene_type is optional; an untagged event still parses."""
    raw = {
        **BASE,
        "type": "critique_submitted",
        "scene_id": "s_crit_1",
        "llm_score": 0.8,
        "completion_rate": 1.0,
    }
    event = adapter.validate_python(raw)
    assert event.type == "critique_submitted"
    assert event.scene_type is None
    redumped = json.loads(adapter.dump_json(event))
    # scene_type is omitted-or-null when untagged; the other fields round-trip exactly.
    assert redumped.get("scene_type") is None
    assert {k: v for k, v in redumped.items() if k != "scene_type"} == raw


def test_critique_submitted_tagged_round_trip():
    for st in ["ai_critique", "spot_the_flaw", "explain_back"]:
        raw = {
            **BASE,
            "type": "critique_submitted",
            "scene_id": "s_crit_1",
            "llm_score": 0.8,
            "completion_rate": 1.0,
            "scene_type": st,
        }
        event = adapter.validate_python(raw)
        assert event.scene_type == st
        redumped = json.loads(adapter.dump_json(event))
        assert redumped == raw


def test_critique_submitted_rejects_invalid_scene_type():
    import pytest
    from pydantic import ValidationError
    raw = {
        **BASE,
        "type": "critique_submitted",
        "scene_id": "s_crit_1",
        "llm_score": 0.8,
        "completion_rate": 1.0,
        "scene_type": "quiz",
    }
    with pytest.raises(ValidationError):
        adapter.validate_python(raw)
