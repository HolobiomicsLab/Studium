"""Pydantic mirror of TS Zod telemetry-events.

Common base + 9 event types. Discriminated union via `type` field.
Convention rule 004: never imported as `events` at root level.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str
    learner_pseudonym: str
    lesson_id: str
    bundle_version: str
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


TelemetryEvent = Annotated[
    Union[LessonStarted, SceneEntered, SceneCompleted, QuizAnswered,
          AdaptationApplied, CritiqueSubmitted, LessonCompleted,
          ConsentGranted, ForgetRequested],
    Field(discriminator="type"),
]

__all__ = [
    "TelemetryEvent",
    "LessonStarted", "SceneEntered", "SceneCompleted", "QuizAnswered",
    "AdaptationApplied", "CritiqueSubmitted", "LessonCompleted",
    "ConsentGranted", "ForgetRequested",
]
