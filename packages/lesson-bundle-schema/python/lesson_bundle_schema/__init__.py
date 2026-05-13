"""Pydantic mirror du LessonBundle TypeScript (rule 002 — validation côté Python).

ADR 010 — flat shape : tous les types de scène déclarent leurs champs métier
à la racine, sans enveloppe `content`. schema_version bumped to 1.1.
"""
from __future__ import annotations
from typing import Annotated, Any, Optional, Literal, Union
from pydantic import BaseModel, Field


SceneType = Literal[
    "intro", "concept", "quiz", "meta_checkpoint",
    "reproduction", "ai_critique", "discussion",
]
ReasoningSignalEnum = Literal[
    "justification", "hypothesis", "question", "counterexample", "synthesis",
]
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


class _SceneBase(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(default=0, ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)


class QuizChoice(BaseModel):
    id: str
    text: str
    correct: bool


class IntroScene(_SceneBase):
    type: Literal["intro"]
    markdown: str


class ConceptScene(_SceneBase):
    type: Literal["concept"]
    markdown: str
    image_path: Optional[str] = None


class QuizScene(_SceneBase):
    type: Literal["quiz"]
    question: str
    choices: list[QuizChoice] = Field(min_length=2, max_length=6)
    feedback_correct: str
    feedback_incorrect: str
    hints: list[str] = Field(default_factory=list)


class MetaCheckpointScene(_SceneBase):
    type: Literal["meta_checkpoint"]
    pre_question: str
    post_question: str
    scale_labels: list[str] = Field(min_length=5, max_length=5)


class ReproductionStep(BaseModel):
    step_id: str
    instruction: str
    expected_input_schema: dict[str, Any]
    expected_output: Union[str, dict[str, Any]]


class ReproductionScene(_SceneBase):
    type: Literal["reproduction"]
    task_card_id: str
    steps: list[ReproductionStep] = Field(min_length=1)
    prov_derived_from: Optional[str] = None


class Claim(BaseModel):
    id: str
    text: str
    flaws_expected: list[str]


class AICritiqueRubric(BaseModel):
    completeness: float = Field(ge=0, le=1)
    evidence_quality: float = Field(ge=0, le=1)
    tone: float = Field(ge=0, le=1)


class AICritiqueScene(_SceneBase):
    type: Literal["ai_critique"]
    claims: list[Claim] = Field(min_length=1, max_length=3)
    rubric: AICritiqueRubric


class DiscussionScene(_SceneBase):
    type: Literal["discussion"]
    topic: str = Field(min_length=1)
    seed_claim: str = Field(min_length=1)
    target_signals: list[ReasoningSignalEnum] = Field(min_length=1)
    max_turns: int = Field(gt=0, le=50)


SceneUnion = Union[
    IntroScene, ConceptScene, QuizScene, MetaCheckpointScene,
    ReproductionScene, AICritiqueScene, DiscussionScene,
]
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
    schema_version: Literal["1.2"]
    bundle_id: str
    source_plan_id: str
    metadata: BundleMetadata
    concepts: list[Concept] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    rules: list[AdaptationRule]
    validated_by: str = Field(min_length=3)
    validated_at: str
