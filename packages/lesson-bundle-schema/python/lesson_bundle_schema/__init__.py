"""Pydantic mirror du LessonBundle TypeScript (rule 002 — validation côté Python)."""
from __future__ import annotations
from typing import Annotated, Optional, Literal, Union
from pydantic import BaseModel, Field


SceneType = Literal["intro", "concept", "quiz", "meta_checkpoint"]
BloomLevel = Literal["remember", "understand", "apply", "analyze", "evaluate", "create"]
Modulator = Literal["M1", "M2", "M3", "M6"]


class Concept(BaseModel):
    id: str
    title: str
    description: str
    bloom_level_target: BloomLevel


class BundleMetadata(BaseModel):
    title: str
    target: str
    duration_minutes: int = Field(gt=0)
    language: str = Field(min_length=2)
    discipline: str


class IntroContent(BaseModel):
    markdown: str


class ConceptContent(BaseModel):
    markdown: str
    image_path: Optional[str] = None


class QuizChoice(BaseModel):
    id: str
    text: str
    correct: bool


class QuizContent(BaseModel):
    question: str
    choices: list[QuizChoice] = Field(min_length=2, max_length=6)
    feedback_correct: str
    feedback_incorrect: str
    hints: list[str] = Field(default_factory=list)


class MetaCheckpointContent(BaseModel):
    pre_question: str
    post_question: str
    scale_labels: list[str] = Field(min_length=5, max_length=5)


class IntroScene(BaseModel):
    id: str
    type: Literal["intro"]
    title: str
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)
    content: IntroContent


class ConceptScene(BaseModel):
    id: str
    type: Literal["concept"]
    title: str
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)
    content: ConceptContent


class QuizScene(BaseModel):
    id: str
    type: Literal["quiz"]
    title: str
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)
    content: QuizContent


class MetaCheckpointScene(BaseModel):
    id: str
    type: Literal["meta_checkpoint"]
    title: str
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)
    content: MetaCheckpointContent


SceneUnion = Union[IntroScene, ConceptScene, QuizScene, MetaCheckpointScene]
Scene = Annotated[SceneUnion, Field(discriminator="type")]


class RuleAction(BaseModel):
    kind: Literal[
        "advance_to_next_scene",
        "replay_current_scene",
        "skip_to_next_concept",
        "show_calibration_panel",
        "show_explanation_panel",
    ]
    reason: Optional[str] = None


class AdaptationRule(BaseModel):
    id: str
    when: dict[str, str]
    action: RuleAction
    modulator: Modulator
    explanation_short: str


class LessonBundle(BaseModel):
    schema_version: Literal["1.0"]
    bundle_id: str
    source_plan_id: str
    metadata: BundleMetadata
    concepts: list[Concept] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    rules: list[AdaptationRule]
    validated_by: str = Field(min_length=3)
    validated_at: str
