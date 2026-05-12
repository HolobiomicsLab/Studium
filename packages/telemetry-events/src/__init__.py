"""Pydantic mirror of TS Zod telemetry-events.

Common base + 11 event types. Discriminated union via `type` field.
Convention rule 004: never imported as `events` at root level.

ADR 006 amendment v1.1 adds `reasoning_signal` (M5.9 discussion scenes)
and `ai_audit_result` (ai_audit / ai_critique scenes). Both events are
strict: no free text transmitted — only counters and a classification
label.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    learner_pseudonym: str
    lesson_id: str
    # bundle_version (M5.7) — convention : ``<schema_version>:<bundle_id>@<validated_at>``.
    # Exemple : ``"1.1:demo-metabolomics-001@2026-05-08T10:00:00Z"``.
    # Optionnel et rétro-compatible : les events ingérés sans bundle_version
    # sont bucketed sous ``"unversioned"`` côté collector.
    bundle_version: str = "unversioned"
    client_timestamp: str


class LessonStarted(_Base):
    type: Literal["lesson_started"]
    bundle_uri: str


class SceneEntered(_Base):
    type: Literal["scene_entered"]
    scene_id: str
    scene_type: str


class SceneCompleted(_Base):
    type: Literal["scene_completed"]
    scene_id: str
    duration_ms: int = Field(ge=0)
    success: bool


class QuizAnswered(_Base):
    type: Literal["quiz_answered"]
    scene_id: str
    item_id: str
    correct: bool
    response_time_ms: int = Field(ge=0)
    confidence: float = Field(ge=0, le=1)


class AdaptationApplied(_Base):
    type: Literal["adaptation_applied"]
    rule_id: str
    signal: str
    modulator: str
    value: float


class CritiqueSubmitted(_Base):
    type: Literal["critique_submitted"]
    scene_id: str
    llm_score: float = Field(ge=0, le=1)
    completion_rate: float = Field(ge=0, le=1)


class LessonCompleted(_Base):
    type: Literal["lesson_completed"]
    total_duration_ms: int = Field(ge=0)
    autonomy_ratio: float = Field(ge=0, le=1)


class ConsentGranted(_Base):
    type: Literal["consent_granted"]
    scope: Literal["A", "B", "C"]


class ForgetRequested(_Base):
    type: Literal["forget_requested"]


class ReasoningSignal(_Base):
    type: Literal["reasoning_signal"]
    scene_id: str
    signal: Literal[
        "justification",
        "hypothesis",
        "question",
        "counterexample",
        "synthesis",
    ]
    confidence: float = Field(ge=0, le=1)
    turn_index: int = Field(ge=0)


class AIAuditResult(_Base):
    type: Literal["ai_audit_result"]
    scene_id: str
    planted_errors: int = Field(ge=0)
    true_positives: int = Field(ge=0)
    false_positives: int = Field(ge=0)
    missed: int = Field(ge=0)


TelemetryEvent = Annotated[
    Union[LessonStarted, SceneEntered, SceneCompleted, QuizAnswered,
          AdaptationApplied, CritiqueSubmitted, LessonCompleted,
          ConsentGranted, ForgetRequested,
          ReasoningSignal, AIAuditResult],
    Field(discriminator="type"),
]

__all__ = [
    "TelemetryEvent",
    "LessonStarted", "SceneEntered", "SceneCompleted", "QuizAnswered",
    "AdaptationApplied", "CritiqueSubmitted", "LessonCompleted",
    "ConsentGranted", "ForgetRequested",
    "ReasoningSignal", "AIAuditResult",
]
