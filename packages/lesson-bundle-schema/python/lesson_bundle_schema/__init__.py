"""Pydantic mirror du LessonBundle TypeScript (rule 002 — validation côté Python).

ADR 010 — flat shape : tous les types de scène déclarent leurs champs métier
à la racine, sans enveloppe `content`. schema_version bumped to 1.1.
ADR 014 — Evidence : champs evidence optionnels sur IntroScene, ConceptScene,
ReproductionScene. schema_version bumped to 1.4.
"""
from __future__ import annotations
from typing import Annotated, Any, Optional, Literal, Union
from pydantic import BaseModel, Field, field_validator

SCHEMA_VERSION = "1.4"

# ---------------------------------------------------------------------------
# ADR 014 — Evidence models (Pydantic mirror of Zod EvidenceSchema)
# ---------------------------------------------------------------------------

PerspicaciteMode = Literal["basic", "advanced", "profound", "agentic", "passages"]
ABSAssetType = Literal[
    "spectrum_viewer_svg", "code_snippet", "data_csv", "protocol_card_md", "script_snippet"
]


class BibliographicRef(BaseModel):
    perspicacite_doc_id: str = Field(min_length=1)
    doi: Optional[str] = None
    title: str = Field(min_length=1)
    authors: list[str]
    year: Optional[int] = None
    excerpt: str = Field(max_length=500)
    relevance_score: float = Field(ge=0, le=1)
    prov_derived_from: str = Field(min_length=1)


class CaseStudy(BaseModel):
    title: str = Field(min_length=1)
    summary: str = Field(max_length=1000)
    source_refs: list[str]


class ABSAsset(BaseModel):
    asset_type: ABSAssetType
    payload_inline: Optional[str] = None
    payload_path: Optional[str] = None
    abs_task_card_id: Optional[str] = None
    prov_derived_from: str = Field(min_length=1)


class EnrichmentMetadata(BaseModel):
    enricher_version: str = Field(min_length=1)
    perspicacite_mode_used: PerspicaciteMode
    timestamp: str = Field(min_length=1)
    degraded: bool


class Evidence(BaseModel):
    bibliographic_refs: Optional[list[BibliographicRef]] = None
    case_studies: Optional[list[CaseStudy]] = None
    abs_asset: Optional[ABSAsset] = None
    enrichment_metadata: EnrichmentMetadata


SceneType = Literal[
    "intro", "concept", "quiz", "meta_checkpoint",
    "reproduction", "ai_critique", "discussion",
    # active-learning scenes (learner-as-active-agent):
    "spot_the_flaw", "explain_back",
    # active-learning wave-1: comparison / summary_audit / prompt_practice.
    "comparison", "summary_audit", "prompt_practice",
    # active-learning wave-2 (D2): simulate a professional communication situation.
    "communication_sim",
]
ReasoningSignalEnum = Literal[
    "justification", "hypothesis", "question", "counterexample", "synthesis",
]
BloomLevel = Literal["remember", "understand", "apply", "analyze", "evaluate", "create"]
# Active modulator set — mirrors the registry in src/modulators.ts (pinned by modulators.guard.test.ts).
Modulator = Literal["M1", "M3", "M6"]


class Concept(BaseModel):
    id: str
    title: str
    description: str
    bloom_level_target: BloomLevel


AuthoringMode = Literal["teacher", "self_study"]


class BundleAuthoring(BaseModel):
    """Who wrote the bundle (mirror of Zod BundleAuthoringSchema).

    ``self_study``: the learner (or their agent) authored the lesson from
    references they chose; author-keyed scenes (quiz, spot_the_flaw, …) carry a
    key written by the person who will answer them.
    """

    mode: AuthoringMode
    author_is_learner: bool = False
    note: Optional[str] = None


class BundleMetadata(BaseModel):
    title: str
    target: str
    duration_minutes: int = Field(gt=0)
    language: str = Field(min_length=2)
    discipline: str
    # Absent on bundles built before 2026-10-30; readers treat absent as "teacher".
    authoring: Optional[BundleAuthoring] = None


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
    evidence: Optional[Evidence] = None


class ConceptScene(_SceneBase):
    type: Literal["concept"]
    markdown: str
    image_path: Optional[str] = None
    evidence: Optional[Evidence] = None


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
    evidence: Optional[Evidence] = None


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


class FlawClaim(Claim):
    """A spot_the_flaw claim: flaws_expected MUST be non-empty (stricter than ai_critique's Claim)."""

    flaws_expected: list[str] = Field(min_length=1)


class SoundClaim(BaseModel):
    """A claim in flawed_content that is actually CORRECT — the over-distrust answer key (mirror of TS
    SoundClaim). A good auditor must NOT flag it; server-side (stripped by publicScene)."""

    id: str
    text: str


class SpotTheFlawScene(_SceneBase):
    type: Literal["spot_the_flaw"]
    flawed_content: str = Field(min_length=1)
    claims: list[FlawClaim] = Field(min_length=1, max_length=5)
    model_correction: str = Field(min_length=1)
    rubric: AICritiqueRubric
    # OPTIONAL over-distrust answer key (mirror of TS sound_claims): correct claims a good auditor must
    # not flag. Carried so a live AuditJudge can measure over-distrust; absent ⇒ over-distrust unmeasured.
    sound_claims: Optional[list[SoundClaim]] = None


class KeyPoint(BaseModel):
    id: str
    text: str
    cues: list[str] = Field(min_length=1)


class ExplainBackScene(_SceneBase):
    type: Literal["explain_back"]
    prompt: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1, max_length=6)
    model_explanation: str = Field(min_length=1)
    rubric: AICritiqueRubric


class ComparisonScene(_SceneBase):
    type: Literal["comparison"]
    prompt: str = Field(min_length=1)
    artifact_a: str = Field(min_length=1)
    artifact_b: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1)
    model_answer: str = Field(min_length=1)
    rubric: AICritiqueRubric


class SummaryAuditScene(_SceneBase):
    type: Literal["summary_audit"]
    source_content: str = Field(min_length=1)
    ai_summary: str = Field(min_length=1)
    claims: list[FlawClaim] = Field(min_length=1, max_length=5)
    model_correction: str = Field(min_length=1)
    rubric: AICritiqueRubric


class PromptPracticeScene(_SceneBase):
    type: Literal["prompt_practice"]
    task: str = Field(min_length=1)
    starter_prompt: Optional[str] = None
    key_points: list[KeyPoint] = Field(min_length=1)
    model_prompt: str = Field(min_length=1)
    rubric: AICritiqueRubric


class CommunicationSimScene(_SceneBase):
    type: Literal["communication_sim"]
    scenario: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1)
    model_response: str = Field(min_length=1)
    rubric: AICritiqueRubric


SceneUnion = Union[
    IntroScene, ConceptScene, QuizScene, MetaCheckpointScene,
    ReproductionScene, AICritiqueScene, DiscussionScene,
    SpotTheFlawScene, ExplainBackScene,
    ComparisonScene, SummaryAuditScene, PromptPracticeScene,
    CommunicationSimScene,
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


BlueprintEndpoint = Literal[
    "progress", "calibration", "autonomy", "ai_literacy", "reasoning", "ai_audit",
]


class BlueprintMetricRef(BaseModel):
    endpoint: BlueprintEndpoint
    field: str = Field(min_length=1)
    weight_in_dimension: float = Field(ge=0, le=1)


class BlueprintDimension(BaseModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    weight: float = Field(ge=0, le=1)
    metrics: list[BlueprintMetricRef] = Field(min_length=1)

    @field_validator("metrics")
    @classmethod
    def validate_metric_weights_sum(cls, v):
        s = sum(m.weight_in_dimension for m in v)
        if abs(s - 1.0) > 0.001:
            raise ValueError(f"metrics weight_in_dimension must sum to 1.0 (got {s:.3f})")
        return v


class AssessmentBlueprint(BaseModel):
    dimensions: list[BlueprintDimension] = Field(min_length=1)

    @field_validator("dimensions")
    @classmethod
    def validate_dimension_weights_sum(cls, v):
        s = sum(d.weight for d in v)
        if abs(s - 1.0) > 0.001:
            raise ValueError(f"dimensions weight must sum to 1.0 (got {s:.3f})")
        return v


class LessonBundle(BaseModel):
    schema_version: Literal["1.4"]
    bundle_id: str
    source_plan_id: str
    metadata: BundleMetadata
    concepts: list[Concept] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    rules: list[AdaptationRule]
    validated_by: str = Field(min_length=3)
    validated_at: str
    assessment_blueprint: Optional[AssessmentBlueprint] = None
    learning_workflow_graph: Optional[dict[str, Any]] = None
    universes: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# LAItemEnvelope — "learner-as-author" governance wrapper.
# Pydantic mirror of packages/lesson-bundle-schema/src/learner-item.ts
# (dual-path, rule 002). Keep in PARITY with the Zod definitions.
#
# CORE INVARIANT: `scene` is a SCHEMA-PURE member of the `Scene` discriminated
# union — no learner/governance/peer key may leak into the scene body. All such
# metadata lives at the envelope level.
# PRIVACY: `author_pseudonym` is an HMAC, SERVER-ONLY; it MUST NEVER appear in
# any emitted bundle (survives only as `prior_author` in the ledger).
# `peer_signals` are ledger-only and k-suppressed in any view.
# ---------------------------------------------------------------------------

# Forward-only lifecycle. Learner endpoints can ONLY write `submitted`.
LAReviewState = Literal[
    "submitted",
    "peer_review",
    "revision_requested",
    "approved",
    "published",
    "rejected",
]

# Coarse, enum-only moderation reason (free text never leaves the backend).
LAReviewNoteCode = Literal[
    "factual_error",
    "ambiguous_distractor",
    "off_topic",
    "ok",
]


class LAValidation(BaseModel):
    """Mirror of scene-synth ``validate_scene()`` verdict."""

    ok: bool
    validator_version: str = Field(min_length=1)
    errors: list[str] = Field(default_factory=list)


class LAPeerSignals(BaseModel):
    """RESERVED for the P3 peer-review loop. Ledger-only; k-suppressed in views."""

    n_tests: int = Field(ge=0)
    n_ratings: int = Field(ge=0)
    mean_rating: float
    helpful_votes: int = Field(ge=0)


class LAItemEnvelope(BaseModel):
    item_id: str = Field(min_length=1)
    course_id: str = Field(min_length=1)
    target_bundle_ref: str = Field(min_length=1)
    schema_version: Literal["1.4"] = "1.4"
    # SCHEMA-PURE: a verbatim member of the Scene discriminated union.
    scene: Scene
    # HMAC, SERVER-ONLY — NEVER distributed in any emitted bundle.
    author_pseudonym: str = Field(min_length=1)
    prior_author: Optional[str] = None
    created_at: str = Field(min_length=1)  # ISO-Z, passed-in (never now())
    review_state: LAReviewState
    reviewed_by: Optional[str] = None  # teacher IRI
    reviewed_at: Optional[str] = None  # ISO-Z, passed-in
    review_note_code: Optional[LAReviewNoteCode] = None
    validation: LAValidation
    peer_signals: Optional[LAPeerSignals] = None  # RESERVED (P3); ledger-only
    published_bundle_ref: Optional[str] = None  # file:// of emitted community bundle

    @field_validator("created_at")
    @classmethod
    def _created_at_iso(cls, v: str) -> str:
        # parity with the Zod mirror's z.string().datetime()
        from datetime import datetime
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v

    @field_validator("reviewed_at")
    @classmethod
    def _reviewed_at_iso(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            from datetime import datetime
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        return v
