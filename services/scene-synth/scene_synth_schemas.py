"""Pydantic mirror de packages/lesson-bundle-schema (TS Zod).

Convention rule 004 : ce module n'est jamais importé sous le nom `schemas`
au niveau racine ; toujours `from scene_synth_schemas import ...`.

Ce module reproduit le LessonBundleSchema TypeScript (cf.
``packages/lesson-bundle-schema/src/``) côté Python pour le service
scene-synth (A2). Il étend également le schéma avec les deux nouveaux types
de scène introduits dans A2 :

- ``reproduction`` (carte-tâche reproductible)
- ``ai_critique`` (critique d'affirmations IA-générées)

Le round-trip ``parse -> dump -> compare equal`` est vérifié par
``tests/unit/test_schemas_round_trip.py`` sur la fixture M3
``fixtures/m3/demo-metabolomics/lesson.json``.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Primitives partagées
# ---------------------------------------------------------------------------

SceneType = Literal[
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
]
BloomLevel = Literal[
    "remember", "understand", "apply", "analyze", "evaluate", "create"
]
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


# ---------------------------------------------------------------------------
# Base scène — champs communs partagés par tous les types
# ---------------------------------------------------------------------------


class _SceneBase(BaseModel):
    """Champs partagés par toutes les scènes (cf. SceneBaseSchema TS)."""

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(default=0, ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Scènes existantes M3 (content nested)
# ---------------------------------------------------------------------------


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


class IntroScene(_SceneBase):
    type: Literal["intro"]
    content: IntroContent


class ConceptScene(_SceneBase):
    type: Literal["concept"]
    content: ConceptContent


class QuizScene(_SceneBase):
    type: Literal["quiz"]
    content: QuizContent


class MetaCheckpointScene(_SceneBase):
    type: Literal["meta_checkpoint"]
    content: MetaCheckpointContent


# ---------------------------------------------------------------------------
# Nouvelles scènes A2 — flat shape (pas de bloc ``content`` imbriqué)
# ---------------------------------------------------------------------------


class ReproductionStep(BaseModel):
    step_id: str
    instruction: str
    expected_input_schema: dict[str, Any]  # JSON Schema
    expected_output: Union[str, dict[str, Any]]


class ReproductionScene(_SceneBase):
    type: Literal["reproduction"]
    task_card_id: str
    steps: list[ReproductionStep] = Field(min_length=1)
    prov_derived_from: Optional[str] = None  # URL


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


# ---------------------------------------------------------------------------
# Discriminated union
# ---------------------------------------------------------------------------


SceneUnion = Union[
    IntroScene,
    ConceptScene,
    QuizScene,
    MetaCheckpointScene,
    ReproductionScene,
    AICritiqueScene,
]
Scene = Annotated[SceneUnion, Field(discriminator="type")]


# ---------------------------------------------------------------------------
# Adaptation rules
# ---------------------------------------------------------------------------


RuleActionKind = Literal[
    "advance_to_next_scene",
    "replay_current_scene",
    "skip_to_next_concept",
    "show_calibration_panel",
    "show_explanation_panel",
]


class RuleAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: RuleActionKind
    reason: Optional[str] = None


class AdaptationRule(BaseModel):
    id: str
    when: dict[str, str]
    action: RuleAction
    modulator: Modulator
    explanation_short: str


# ---------------------------------------------------------------------------
# Bundle (alias rétro-compatible : Bundle == LessonBundle)
# ---------------------------------------------------------------------------


class LessonBundle(BaseModel):
    """Pydantic mirror of LessonBundleSchema (TS)."""

    schema_version: Literal["1.0"]
    bundle_id: str
    source_plan_id: str
    metadata: BundleMetadata
    concepts: list[Concept] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    rules: list[AdaptationRule]
    validated_by: str = Field(min_length=3)
    validated_at: str


# Alias court demandé par la spec A.1 (les tests importent ``Bundle``)
Bundle = LessonBundle


# ---------------------------------------------------------------------------
# A.7 — FastAPI request/response models for the scene-synth service.
# ---------------------------------------------------------------------------


class SynthesizeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_critique: bool = True
    deterministic_seed: Optional[int] = None


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lesson_plan: dict
    abs_capsule_uri: Optional[str] = None
    options: Optional[SynthesizeOptions] = None


class SynthesizeResponse(BaseModel):
    bundle_uri: str
    scenes_generated: int
    prov_graph_nodes: int
    warnings: list[str]


class CritiqueEvalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claims: list[Claim]
    rubric: AICritiqueRubric
    student_critique: str = Field(min_length=1)


class CritiqueEvalResponse(BaseModel):
    score: float = Field(ge=0, le=1)
    feedback: str


__all__ = [
    "AICritiqueRubric",
    "AICritiqueScene",
    "AdaptationRule",
    "BloomLevel",
    "Bundle",
    "Claim",
    "Concept",
    "ConceptContent",
    "ConceptScene",
    "CritiqueEvalRequest",
    "CritiqueEvalResponse",
    "IntroContent",
    "IntroScene",
    "LessonBundle",
    "MetaCheckpointContent",
    "MetaCheckpointScene",
    "Modulator",
    "QuizChoice",
    "QuizContent",
    "QuizScene",
    "ReproductionScene",
    "ReproductionStep",
    "RuleAction",
    "RuleActionKind",
    "Scene",
    "SceneType",
    "SceneUnion",
    "SynthesizeOptions",
    "SynthesizeRequest",
    "SynthesizeResponse",
]
