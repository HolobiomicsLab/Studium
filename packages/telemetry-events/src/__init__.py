"""Pydantic mirror of TS Zod telemetry-events.

Common base + 14 event types. Discriminated union via `type` field.
Convention rule 004: never imported as `events` at root level.

ADR 006 amendment v1.1 adds `reasoning_signal` (M5.9 discussion scenes)
and `ai_audit_result` (ai_audit / ai_critique scenes).

ADR 006 amendment v1.3 (views v0.4) adds `journal_entry_submitted`
(reflective writing), `cooperative_vote` (per-vote emission, aggregate
only) and `cooperative_convergence` (cooperative synthesis recap).

All v1.1/v1.3 events are strict: no free text transmitted — only counters,
labels and aggregated histograms.
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


class JournalEntrySubmitted(_Base):
    type: Literal["journal_entry_submitted"]
    scene_id: str
    entry_length: int = Field(ge=0)
    revision_count: int = Field(ge=0)
    is_revision: bool


class CooperativeVote(_Base):
    type: Literal["cooperative_vote"]
    question_id: str
    group_size: int = Field(ge=2, le=6)
    aggregate_only: bool


class CooperativeConvergence(_Base):
    type: Literal["cooperative_convergence"]
    synthesis_id: str
    group_size: int = Field(ge=2, le=6)
    confidence_distribution_aggregated: list[Annotated[int, Field(ge=0)]] = Field(
        min_length=5, max_length=5
    )
    role_coverage: float = Field(ge=0, le=1)


TelemetryEvent = Annotated[
    Union[LessonStarted, SceneEntered, SceneCompleted, QuizAnswered,
          AdaptationApplied, CritiqueSubmitted, LessonCompleted,
          ConsentGranted, ForgetRequested,
          ReasoningSignal, AIAuditResult,
          JournalEntrySubmitted, CooperativeVote, CooperativeConvergence],
    Field(discriminator="type"),
]

__all__ = [
    "TelemetryEvent",
    "LessonStarted", "SceneEntered", "SceneCompleted", "QuizAnswered",
    "AdaptationApplied", "CritiqueSubmitted", "LessonCompleted",
    "ConsentGranted", "ForgetRequested",
    "ReasoningSignal", "AIAuditResult",
    "JournalEntrySubmitted", "CooperativeVote", "CooperativeConvergence",
]
