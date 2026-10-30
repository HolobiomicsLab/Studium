#!/usr/bin/env python3
"""Validate and publish Studium's learner-selected activity action contract.

The sidecar records semantic actions explicitly exported by a learner-facing
activity or declared by its harness. It is separate from the host experiment
journal and from ASTRA. Missing events never prove that an action or assistance
did not occur.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

SCHEMA_ID = "studium/learner-actions/v1"
EVENT_KINDS = (
    "activity_started",
    "learner_text_submitted",
    "parameter_changed",
    "learner_choice_selected",
    "assistance_requested",
    "assistance_provided",
    "results_revealed",
    "activity_completed",
)

_ID_PATTERN = r"^[A-Za-z0-9_-]{1,120}$"
_SHA256_PATTERN = r"^[0-9a-f]{64}$"
_TEXT_MAX = 12_000
_MAX_JSON_BYTES = 5_000_000


class StrictModel(BaseModel):
    """Base for wire records that reject unrecognized fields."""

    model_config = ConfigDict(extra="forbid", strict=True)


class EmptyData(StrictModel):
    """An event intentionally carrying no additional values."""


class LearnerTextData(StrictModel):
    """One learner-declared contribution, preserved verbatim after validation."""

    phase: Literal["prediction", "observation", "conclusion"]
    text: str = Field(min_length=1, max_length=_TEXT_MAX)
    confidence: int | None = Field(default=None, ge=0, le=4)

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        """Reject blank contributions without trimming their original wording."""
        if not value.strip():
            raise ValueError("text must not be blank")
        return value


class ParameterChangedData(StrictModel):
    """A finite before/after value for one bounded activity parameter."""

    parameter_id: str = Field(pattern=_ID_PATTERN)
    before: float
    after: float

    @field_validator("before", "after")
    @classmethod
    def require_finite_number(cls, value: float) -> float:
        """Reject NaN and infinities, which JSON cannot represent portably."""
        if not math.isfinite(value):
            raise ValueError("parameter values must be finite")
        return value


class ChoiceData(StrictModel):
    """Stable identifier of a learner-selected option."""

    choice_id: str = Field(pattern=_ID_PATTERN)


class AssistanceData(StrictModel):
    """Optional reported assistance text; reports redact it by default."""

    text: str | None = Field(default=None, min_length=1, max_length=_TEXT_MAX)

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str | None) -> str | None:
        """Accept omission, while refusing a meaningless blank declaration."""
        if value is not None and not value.strip():
            raise ValueError("assistance text must not be blank")
        return value


class ActivityEventBase(StrictModel):
    """Fields common to every semantic action."""

    sequence: int = Field(gt=0)
    recorded_at: str

    @field_validator("recorded_at")
    @classmethod
    def require_utc_rfc3339(cls, value: str) -> str:
        """Require an explicit UTC RFC3339 timestamp without changing it."""
        if not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})",
            value,
        ):
            raise ValueError("recorded_at must be an RFC3339 timestamp")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.utcoffset() != timedelta(0):
            raise ValueError("recorded_at must be UTC")
        return value


class BrowserEventBase(ActivityEventBase):
    """An action the learner-facing browser reports observing."""

    actor: Literal["learner"]
    origin: Literal["browser_observed"]


class ActivityStartedEvent(BrowserEventBase):
    """The learner opened or started the selected activity."""

    kind: Literal["activity_started"]
    data: EmptyData


class LearnerTextEvent(BrowserEventBase):
    """A prediction, observation or conclusion declared as learner-authored."""

    kind: Literal["learner_text_submitted"]
    data: LearnerTextData


class ParameterChangedEvent(BrowserEventBase):
    """A learner changed one numeric activity control."""

    kind: Literal["parameter_changed"]
    data: ParameterChangedData


class ChoiceSelectedEvent(BrowserEventBase):
    """A learner selected one stable option identifier."""

    kind: Literal["learner_choice_selected"]
    data: ChoiceData


class AssistanceRequestedEvent(BrowserEventBase):
    """The browser reports an explicit learner request for assistance."""

    kind: Literal["assistance_requested"]
    data: AssistanceData


class ResultsRevealedEvent(BrowserEventBase):
    """The learner chose to reveal the activity result."""

    kind: Literal["results_revealed"]
    data: EmptyData


class ActivityCompletedEvent(BrowserEventBase):
    """The browser reports explicit activity completion."""

    kind: Literal["activity_completed"]
    data: EmptyData


class AssistanceProvidedEvent(ActivityEventBase):
    """Assistance the harness itself declares providing."""

    actor: Literal["harness"]
    origin: Literal["harness_declared"]
    kind: Literal["assistance_provided"]
    data: AssistanceData


ActivityEvent = Annotated[
    ActivityStartedEvent
    | LearnerTextEvent
    | ParameterChangedEvent
    | ChoiceSelectedEvent
    | AssistanceRequestedEvent
    | AssistanceProvidedEvent
    | ResultsRevealedEvent
    | ActivityCompletedEvent,
    Field(discriminator="kind"),
]


class LearnerActivityDocument(StrictModel):
    """One versioned activity timeline with no dedicated learner-identity field."""

    schema_id: Literal[SCHEMA_ID] = Field(alias="schema")
    activity_id: str = Field(pattern=_ID_PATTERN)
    template_id: str = Field(pattern=_ID_PATTERN)
    template_version: str = Field(min_length=1, max_length=80)
    scene_id: str = Field(min_length=1, max_length=240)
    activity_sha256: str | None = Field(default=None, pattern=_SHA256_PATTERN)
    events: list[ActivityEvent] = Field(min_length=1, max_length=1_000)

    @field_validator("template_version")
    @classmethod
    def reject_blank_version(cls, value: str) -> str:
        """Keep the producer's version text while rejecting blanks."""
        if not value.strip():
            raise ValueError("template_version must not be blank")
        return value

    @field_validator("scene_id")
    @classmethod
    def reject_blank_scene_id(cls, value: str) -> str:
        """Preserve a public Studium scene identifier without inventing a grammar."""
        if not value.strip():
            raise ValueError("scene_id must not be blank")
        return value

    @model_validator(mode="after")
    def validate_event_order(self) -> "LearnerActivityDocument":
        """Reject duplicate or impossible action order without repairing clocks."""
        sequences = [event.sequence for event in self.events]
        if sequences != list(range(1, len(self.events) + 1)):
            raise ValueError("event sequence must be unique and contiguous from 1")
        kinds = [event.kind for event in self.events]
        if kinds[0] != "activity_started":
            raise ValueError("activity start must be the first event")
        if kinds.count("activity_started") != 1:
            raise ValueError("activity start must occur exactly once")
        if kinds.count("results_revealed") > 1:
            raise ValueError("results reveal must occur at most once")
        if kinds.count("activity_completed") > 1:
            raise ValueError("activity completion must occur at most once")
        if "activity_completed" in kinds and kinds[-1] != "activity_completed":
            raise ValueError("activity completion must be last")
        self._validate_phase_order(kinds)
        return self

    def _validate_phase_order(self, kinds: list[str]) -> None:
        """Check the recorded prediction/reveal/observation/conclusion sequence."""
        phases = [
            (index, event.data.phase)
            for index, event in enumerate(self.events)
            if isinstance(event, LearnerTextEvent)
        ]
        phase_names = [phase for _, phase in phases]
        if len(phase_names) != len(set(phase_names)):
            raise ValueError("each learner text phase may be recorded at most once")
        reveal = kinds.index("results_revealed") if "results_revealed" in kinds else None
        for index, phase in phases:
            if phase == "prediction" and reveal is not None and index > reveal:
                raise ValueError("learner prediction must precede results reveal")
            if phase in {"observation", "conclusion"} and (reveal is None or index < reveal):
                raise ValueError(f"learner {phase} requires an earlier results reveal")
        if "observation" in phase_names and "conclusion" in phase_names:
            if phase_names.index("conclusion") < phase_names.index("observation"):
                raise ValueError("learner conclusion must follow learner observation")


def validate_trace_payload(payload: object) -> LearnerActivityDocument:
    """Validate one decoded sidecar payload and return its typed document."""
    return LearnerActivityDocument.model_validate(payload)


def activity_json_schema() -> dict:
    """Return the JSON Schema generated from the sole runtime contract."""
    return LearnerActivityDocument.model_json_schema()


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """Build a JSON object while rejecting ambiguous duplicate member names."""
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _reject_nonfinite_constant(value: str) -> None:
    """Reject the NaN/Infinity extensions accepted by Python's JSON decoder."""
    raise ValueError(f"non-finite JSON number: {value}")


def read_json_payload(path: Path) -> object:
    """Read JSON without accepting duplicate members or non-finite numbers."""
    if path.stat().st_size > _MAX_JSON_BYTES:
        raise ValueError(f"JSON input exceeds {_MAX_JSON_BYTES} bytes")
    return json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
        parse_constant=_reject_nonfinite_constant,
    )


def read_trace_file(path: Path) -> LearnerActivityDocument:
    """Read and validate one JSON sidecar without ambiguous JSON values."""
    return validate_trace_payload(read_json_payload(path))


def main(argv: list[str] | None = None) -> int:
    """Run portable validation or export the generated JSON Schema."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="validate one learner-action JSON file")
    validate.add_argument("path", type=Path)
    schema = commands.add_parser("schema", help="write the generated JSON Schema")
    schema.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            read_trace_file(args.path)
            print(f"valid {SCHEMA_ID}: {args.path}")
            return 0
        payload = json.dumps(activity_json_schema(), indent=2, ensure_ascii=False) + "\n"
        if args.out:
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(payload, encoding="utf-8")
            print(args.out)
        else:
            print(payload, end="")
        return 0
    except (OSError, json.JSONDecodeError, ValidationError, ValueError) as exc:
        print(f"learner trace: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
