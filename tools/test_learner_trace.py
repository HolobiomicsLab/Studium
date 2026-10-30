"""Strict contract tests for learner-selected activity actions."""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from learner_trace import (
    EVENT_KINDS,
    SCHEMA_ID,
    LearnerActivityDocument,
    activity_json_schema,
    main,
    validate_trace_payload,
)


def event(sequence: int, kind: str, data: dict | None = None) -> dict:
    """Build one browser-observed learner event for a contract test."""
    return {
        "sequence": sequence,
        "recorded_at": f"2026-09-11T10:00:{sequence:02d}Z",
        "actor": "learner",
        "origin": "browser_observed",
        "kind": kind,
        "data": data or {},
    }


def payload(events: list[dict]) -> dict:
    """Build the smallest valid activity document around ``events``."""
    return {
        "schema": SCHEMA_ID,
        "activity_id": "activity_01",
        "template_id": "controlled-parameter",
        "template_version": "1.0.0",
        "scene_id": "scene_01",
        "events": events,
    }


def test_validates_closed_semantic_event_contract() -> None:
    """Every required v1 semantic action round-trips through the strict model."""
    events = [
        event(1, "activity_started"),
        event(2, "learner_text_submitted", {"phase": "prediction", "text": "Edges increase", "confidence": 2}),
        event(3, "parameter_changed", {"parameter_id": "threshold", "before": 0.7, "after": 0.8}),
        event(4, "learner_choice_selected", {"choice_id": "candidate_a"}),
        event(5, "assistance_requested", {"text": "What does cosine mean?"}),
        {
            "sequence": 6,
            "recorded_at": "2026-09-11T10:00:06Z",
            "actor": "harness",
            "origin": "harness_declared",
            "kind": "assistance_provided",
            "data": {"text": "Compare peak overlap."},
        },
        event(7, "results_revealed"),
        event(8, "learner_text_submitted", {"phase": "observation", "text": "One edge disappeared"}),
        event(9, "learner_text_submitted", {"phase": "conclusion", "text": "The claim is sensitive"}),
        event(10, "activity_completed"),
    ]
    document = validate_trace_payload(payload(events))
    assert isinstance(document, LearnerActivityDocument)
    assert set(row.kind for row in document.events) == set(EVENT_KINDS)


@pytest.mark.parametrize(
    "patch, message",
    [
        ({"actor": "harness"}, "actor"),
        ({"origin": "harness_declared"}, "origin"),
        ({"recorded_at": "2026-09-11T12:00:01+02:00"}, "UTC"),
        ({"surprise": "hidden"}, "extra"),
    ],
)
def test_rejects_wrong_origin_non_utc_time_and_extra_fields(patch, message) -> None:
    """Capture origin, clock and allowlist boundaries are enforced at admission."""
    candidate = event(1, "activity_started") | patch
    with pytest.raises(ValidationError, match=message):
        validate_trace_payload(payload([candidate]))


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_parameter_values_must_be_finite(value: float) -> None:
    """A reported parameter transition cannot carry JSON-invalid numeric values."""
    events = [event(1, "activity_started"), event(2, "parameter_changed", {
        "parameter_id": "threshold", "before": value, "after": 0.8,
    })]
    with pytest.raises(ValidationError):
        validate_trace_payload(payload(events))


@pytest.mark.parametrize(
    "field, value",
    [("sequence", True), ("sequence", "1")],
)
def test_integer_fields_do_not_coerce_bool_or_string(field: str, value: object) -> None:
    """Wire validation rejects JSON values of the wrong primitive type."""
    candidate = event(1, "activity_started") | {field: value}
    with pytest.raises(ValidationError):
        validate_trace_payload(payload([candidate]))


@pytest.mark.parametrize("value", [True, "0.5"])
def test_numeric_parameter_fields_do_not_coerce_bool_or_string(value: object) -> None:
    """Finite parameter values must arrive as JSON numbers."""
    events = [event(1, "activity_started"), event(2, "parameter_changed", {
        "parameter_id": "threshold", "before": value, "after": 1,
    })]
    with pytest.raises(ValidationError):
        validate_trace_payload(payload(events))


@pytest.mark.parametrize(
    "events, message",
    [
        ([event(2, "activity_started")], "contiguous"),
        ([event(1, "results_revealed")], "start"),
        ([event(1, "activity_started"), event(2, "activity_started")], "exactly once"),
        ([event(1, "activity_started"), event(2, "activity_completed"), event(3, "results_revealed")], "last"),
        ([event(1, "activity_started"), event(2, "results_revealed"), event(3, "learner_text_submitted", {"phase": "prediction", "text": "late"})], "prediction"),
        ([event(1, "activity_started"), event(2, "learner_text_submitted", {"phase": "observation", "text": "premature"})], "reveal"),
        ([event(1, "activity_started"), event(2, "results_revealed"), event(3, "learner_text_submitted", {"phase": "conclusion", "text": "first"}), event(4, "learner_text_submitted", {"phase": "observation", "text": "late"})], "conclusion"),
    ],
)
def test_rejects_impossible_order(events, message) -> None:
    """Sequence and prediction-observation-conclusion order cannot be repaired silently."""
    with pytest.raises(ValidationError, match=message):
        validate_trace_payload(payload(events))


def test_schema_is_generated_from_the_runtime_model() -> None:
    """Template producers can publish one schema without hand-maintained duplication."""
    schema = activity_json_schema()
    assert schema["properties"]["schema"]["const"] == SCHEMA_ID
    assert set(EVENT_KINDS) <= set(json.dumps(schema).split('"'))
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize("digest", ["a" * 63, "A" * 64, "not-a-digest"])
def test_optional_activity_digest_is_exact_lowercase_sha256(digest: str) -> None:
    """A producer-supplied prepared-activity binding has one portable wire form."""
    value = payload([event(1, "activity_started")])
    value["activity_sha256"] = digest
    with pytest.raises(ValidationError):
        validate_trace_payload(value)


def test_valid_activity_digest_is_preserved() -> None:
    """The sidecar may bind its identifiers to one exact prepared definition."""
    value = payload([event(1, "activity_started")])
    value["activity_sha256"] = "a" * 64
    assert validate_trace_payload(value).activity_sha256 == "a" * 64


def test_cli_validates_and_exports_schema(tmp_path, capsys) -> None:
    """The portable CLI exposes the same runtime model used by imports."""
    trace = tmp_path / "trace.json"
    trace.write_text(json.dumps(payload([event(1, "activity_started")])), encoding="utf-8")
    assert main(["validate", str(trace)]) == 0
    assert "valid" in capsys.readouterr().out
    schema_path = tmp_path / "learner-actions.schema.json"
    assert main(["schema", "--out", str(schema_path)]) == 0
    assert json.loads(schema_path.read_text())["properties"]["schema"]["const"] == SCHEMA_ID


@pytest.mark.parametrize(
    "source",
    [
        '{"schema":"studium/learner-actions/v1","schema":"duplicate"}',
        '{"schema":"studium/learner-actions/v1","activity_id":"a","template_id":"t","template_version":"1","scene_id":"s","events":[{"sequence":1,"recorded_at":"2026-09-11T10:00:01Z","actor":"learner","origin":"browser_observed","kind":"parameter_changed","data":{"parameter_id":"p","before":NaN,"after":1}}]}',
    ],
)
def test_cli_rejects_duplicate_keys_and_nonfinite_json(source: str, tmp_path) -> None:
    """Ambiguous or non-standard JSON is rejected before model validation."""
    trace = tmp_path / "bad.json"
    trace.write_text(source, encoding="utf-8")
    assert main(["validate", str(trace)]) == 1
