"""Pydantic mirror de packages/lesson-bundle-schema (TS Zod).

ADR 010 — flat shape : tous les types de scène ont leurs champs métier à la
racine, sans enveloppe ``content``. schema_version bumped to 1.1.
ADR 014 — Evidence fields on IntroScene/ConceptScene/ReproductionScene.
schema_version bumped to 1.4.

Convention rule 004 : ce module n'est jamais importé sous le nom `schemas`
au niveau racine ; toujours `from scene_synth_schemas import ...`.

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

SCHEMA_VERSION = "1.4"

SceneType = Literal[
    "intro",
    "concept",
    "quiz",
    "meta_checkpoint",
    "reproduction",
    "ai_critique",
    # active-learning scenes (learner-as-active-agent):
    "spot_the_flaw",
    "explain_back",
    # active-learning wave-1: comparison / summary_audit / prompt_practice.
    "comparison",
    "summary_audit",
    "prompt_practice",
    # active-learning wave-2 (D2): simulate a professional communication situation.
    "communication_sim",
]
BloomLevel = Literal[
    "remember", "understand", "apply", "analyze", "evaluate", "create"
]
Modulator = Literal["M1", "M2", "M3", "M6"]


# ---------------------------------------------------------------------------
# ADR 014 — Evidence models
# ---------------------------------------------------------------------------

PerspicaciteMode = Literal["basic", "advanced", "profound", "agentic", "passages"]
ABSAssetType = Literal[
    "spectrum_viewer_svg", "code_snippet", "data_csv", "protocol_card_md", "script_snippet",
    # interactive / first-class rich types (rendered client-side):
    "plot_spec", "equation_latex", "orbital_viewer_3d", "molecule_3d", "spectrum_data",
]

# ---------------------------------------------------------------------------
# Normalized render manifest — mirror of packages/lesson-bundle-schema render-asset.ts
# ---------------------------------------------------------------------------

RenderAssetKind = Literal[
    "image", "svg", "equation_latex", "plot_spec", "code", "data_csv",
    "protocol_md", "executed_result",
    # interactive scientific kinds (3Dmol.js / RDKit.js / Vega-Lite):
    "orbital", "mol_3d", "spectrum",
]


class RenderAsset(BaseModel):
    """A normalized, render-by-kind artifact shown pair-by-pair with a scene/cell."""

    kind: RenderAssetKind
    title: Optional[str] = None
    payload: Optional[str] = None  # inline (latex, vega/plotly json, svg, code, csv, md, xyz, cube)
    path: Optional[str] = None  # file path (image / figure / .cube)
    language: Optional[str] = None  # for `code`
    format: Optional[str] = None  # renderer hint: "cube" | "xyz" | "smiles" | "vega-lite"
    provenance: Optional[str] = None
    meta: Optional[dict[str, Any]] = None


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


# ---------------------------------------------------------------------------

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
    """Champs partagés par toutes les scènes (cf. SceneBaseSchema TS)."""

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    concept_refs: list[str] = Field(default_factory=list)
    estimated_seconds: int = Field(default=0, ge=0)
    adaptation_hooks: list[str] = Field(default_factory=list)
    # explicit typed artifacts rendered pair-by-pair with this scene/cell (orbital, spectrum,
    # equation, plot…). Flattened client-side by sceneRenderAssets(); optional + back-compatible.
    render_assets: Optional[list[RenderAsset]] = None


# ---------------------------------------------------------------------------
# Scènes (ADR 010 flat shape — pas d'enveloppe `content`)
# ---------------------------------------------------------------------------


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
    expected_input_schema: dict[str, Any]  # JSON Schema
    expected_output: Union[str, dict[str, Any]]


class ReferenceCheck(BaseModel):
    check: str
    passed: bool


class ReferenceRunProvenance(BaseModel):
    capsule_doi: Optional[str] = None
    cmd: list[str] = Field(default_factory=list)
    env: str


class ReferenceRun(BaseModel):
    """Mirror of ReferenceRunSchema (TS, scenes.ts): the result of executing a capsule once at
    author time. Carried by ``reproduction`` (authenticity) AND ``spot_the_flaw`` (a judgment
    scene whose flawed_content interprets this real run). Populated by tools/capsule_runner.py;
    surfaced as an ``executed_result`` render asset client-side."""

    ran: bool
    passed: bool
    landmark: Optional[str] = None
    figure_path: Optional[str] = None
    checks: list[ReferenceCheck] = Field(default_factory=list)
    provenance: ReferenceRunProvenance


class RunManifest(BaseModel):
    """Mirror of RunManifestSchema (TS, scenes.ts): a learner-time provisioning + run manifest. Studium
    emits it so a pluggable agentic operator provisions the env + installs + runs the capsule IN THE HOST
    WORKSPACE (Studium never executes). NON-answer-bearing — carries only how to RUN (capsule ref / cmd /
    install / produced file names / file-existence checks), never the expected values or author landmark."""

    capsule_ref: str = Field(min_length=1)
    cmd: list[str] = Field(min_length=1)
    working_dir: Optional[str] = None
    timeout_s: Optional[float] = Field(default=None, gt=0)
    requirements: Optional[list[str]] = None
    expected_outputs: list[str]
    verify_checks: list[str]
    research_question: Optional[str] = None


class ReproductionScene(_SceneBase):
    type: Literal["reproduction"]
    task_card_id: str
    steps: list[ReproductionStep] = Field(min_length=1)
    prov_derived_from: Optional[str] = None  # URL
    image_path: Optional[str] = None  # rendered figure from the reference run (parity with TS)
    reference_result: Optional[ReferenceRun] = None  # executed reference run (parity with TS)
    # OPTIONAL learner-time run (parity with TS): when present, the learner reproduces the capsule at
    # session time (host/operator provisions + runs), not merely views a pre-baked author run.
    run_manifest: Optional[RunManifest] = None
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


class FlawClaim(Claim):
    """A spot_the_flaw claim: flaws_expected MUST be non-empty (an assertion with nothing
    to spot would silently fail every learner offline). Stricter than ai_critique's Claim."""

    flaws_expected: list[str] = Field(min_length=1)


class SpotTheFlawScene(_SceneBase):
    """Learner reads a deliberately-flawed mini-lesson and names what is wrong.

    `claims` is the answer key (flawed assertions + flaws_expected keywords) and
    `model_correction` is the corrected reference — both reveals, never rendered
    before the learner responds. Reuses FlawClaim + AICritiqueRubric (mirror of TS)."""

    type: Literal["spot_the_flaw"]
    flawed_content: str = Field(min_length=1)
    claims: list[FlawClaim] = Field(min_length=1, max_length=5)
    model_correction: str = Field(min_length=1)
    rubric: AICritiqueRubric
    # OPTIONAL grounding in a REAL capsule execution (mirror of SpotTheFlawSceneSchema TS): when
    # flawed_content is a deliberately-flawed AI reading of a genuine executed result, the scene
    # carries that run so the learner audits the AI interpretation AGAINST the real output. The run
    # holds no answer key (flaws live in ``claims``), so it is evidence, not a leak.
    reference_result: Optional[ReferenceRun] = None
    # OPTIONAL learner-run grounding (mirror of TS): a task_card_id whose LEARNER-TIME run grounds this
    # judgment (the host injects the recorded run as reference_result at session time — audit YOUR OWN run).
    # SOUNDNESS: DETERMINISTIC capsules only — the authored claims/flaws are NOT regenerated from the
    # learner's run, so a stable landmark across runs is required (see SpotTheFlawSceneSchema TS).
    reference_from_run: Optional[str] = None


class KeyPoint(BaseModel):
    id: str
    text: str
    cues: list[str] = Field(min_length=1)


class ExplainBackScene(_SceneBase):
    """Teach-back: the learner explains a concept, scored by key-point coverage.

    `key_points` (answer key) and `model_explanation` (reference) are reveals,
    never rendered before the learner responds."""

    type: Literal["explain_back"]
    prompt: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1, max_length=6)
    model_explanation: str = Field(min_length=1)
    rubric: AICritiqueRubric


class ComparisonScene(_SceneBase):
    """AI-vs-teacher comparison: the learner reads two artifacts and names the
    differences / added value, scored by key-point coverage.

    `key_points` (answer key) and `model_answer` (reference) are reveals, never
    rendered before the learner responds. Reuses KeyPoint + AICritiqueRubric."""

    type: Literal["comparison"]
    prompt: str = Field(min_length=1)
    artifact_a: str = Field(min_length=1)
    artifact_b: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1)
    model_answer: str = Field(min_length=1)
    rubric: AICritiqueRubric


class SummaryAuditScene(_SceneBase):
    """AI-summary audit: the learner reads a source + its AI summary and names the
    omissions/distortions (learner-as-auditor variant of spot_the_flaw).

    `claims` (answer key, each flaws_expected non-empty) and `model_correction`
    (reference) are reveals, never rendered before the learner responds. Reuses
    FlawClaim + AICritiqueRubric."""

    type: Literal["summary_audit"]
    source_content: str = Field(min_length=1)
    ai_summary: str = Field(min_length=1)
    claims: list[FlawClaim] = Field(min_length=1, max_length=5)
    model_correction: str = Field(min_length=1)
    rubric: AICritiqueRubric


class PromptPracticeScene(_SceneBase):
    """Prompt-engineering exercise: the learner writes/refines a prompt for the
    authored task, scored on prompt-quality cue coverage.

    `key_points` (answer key) and `model_prompt` (reference) are reveals, never
    rendered before the learner responds. `starter_prompt` (optional) IS shown —
    it is the affordance the learner refines, not an answer key. Reuses KeyPoint +
    AICritiqueRubric."""

    type: Literal["prompt_practice"]
    task: str = Field(min_length=1)
    starter_prompt: Optional[str] = None
    key_points: list[KeyPoint] = Field(min_length=1)
    model_prompt: str = Field(min_length=1)
    rubric: AICritiqueRubric


class CommunicationSimScene(_SceneBase):
    """Professional communication simulation (Dubas): the learner is placed in a
    professional situation (scenario = the situation + the learner's role + the
    audience) and must communicate a target message (prompt), scored by how well
    the response hits the authored communication objectives (key_points).

    `key_points` (answer key) and `model_response` (reference) are reveals, never
    rendered before the learner responds. Reuses KeyPoint + AICritiqueRubric."""

    type: Literal["communication_sim"]
    scenario: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    key_points: list[KeyPoint] = Field(min_length=1)
    model_response: str = Field(min_length=1)
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
    SpotTheFlawScene,
    ExplainBackScene,
    ComparisonScene,
    SummaryAuditScene,
    PromptPracticeScene,
    CommunicationSimScene,
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
    """Pydantic mirror of LessonBundleSchema (TS) — ADR 014 v1.4."""

    schema_version: Literal["1.4"]
    bundle_id: str
    source_plan_id: str
    metadata: BundleMetadata
    concepts: list[Concept] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    rules: list[AdaptationRule]
    validated_by: str = Field(min_length=3)
    validated_at: str
    learning_workflow_graph: Optional[dict[str, Any]] = None
    universes: Optional[dict[str, Any]] = None


# Alias court demandé par la spec A.1 (les tests importent ``Bundle``)
Bundle = LessonBundle


# ---------------------------------------------------------------------------
# A.7 — FastAPI request/response models for the scene-synth service.
# ---------------------------------------------------------------------------


class SynthesizeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_critique: bool = True
    deterministic_seed: Optional[int] = None
    # Trustworthiness dial for capsule-grounded spot_the_flaw judgment scenes. The number /
    # subtlety of planted flaws is an AUTHORED parameter (not hardcoded) so a composer can
    # deliberately vary output trustworthiness — what makes a learner's calibration measurable.
    judgment_n_flaws: int = Field(default=1, ge=1, le=5)
    judgment_level: str = "subtle"
    judgment_guidance: str = "subtils et crédibles"


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


# ---------------------------------------------------------------------------
# Learner-as-author (P2) request/response models.
#
# These are TRANSPORT shapes for the scene-synth endpoints. The CANONICAL
# envelope (LAItemEnvelope) + lifecycle live in learner_items_store.py (the
# Pydantic mirror of packages/lesson-bundle-schema/.../learner-item). The
# CLIENT-SAFE view here deliberately OMITS author_pseudonym — it must never be
# emitted in any response. The review-state / note-code literals mirror the
# envelope's LAReviewState / LAReviewNoteCode.
# ---------------------------------------------------------------------------

LAReviewStateLiteral = Literal[
    "submitted",
    "peer_review",
    "revision_requested",
    "approved",
    "published",
    "rejected",
]
LAReviewNoteCodeLiteral = Literal[
    "factual_error", "ambiguous_distractor", "off_topic", "ok"
]
LADecisionLiteral = Literal["approve", "reject", "request_revision"]


class LAValidationView(BaseModel):
    ok: bool
    validator_version: str = Field(min_length=1)
    errors: list[str] = Field(default_factory=list)


class LearnerValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scene: dict  # schema-pure Scene dict; validated by validate_scene().
    course_id: str = Field(min_length=1)


class LearnerValidateResponse(BaseModel):
    ok: bool
    validator_version: str = Field(min_length=1)
    errors: list[str] = Field(default_factory=list)


class LearnerSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: str = Field(min_length=1)
    target_bundle_ref: str = Field(min_length=1)
    scene: dict  # schema-pure Scene dict.
    author_handle: str = Field(min_length=1)  # hashed server-side; never stored raw.
    created_at: str = Field(min_length=1)  # ISO-Z, passed-in (never now()).


class LearnerDecideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: LADecisionLiteral
    reviewer: str = ""  # teacher IRI; emptiness is rejected by decide_item (4xx).
    reviewed_at: str = ""  # ISO-Z, passed-in; emptiness rejected on approve.
    note_code: Optional[LAReviewNoteCodeLiteral] = None


class LearnerItemView(BaseModel):
    """CLIENT-SAFE projection of an LAItemEnvelope — author_pseudonym OMITTED."""

    item_id: str
    course_id: str
    target_bundle_ref: str
    schema_version: str
    scene: Scene
    review_state: LAReviewStateLiteral
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[str] = None
    review_note_code: Optional[LAReviewNoteCodeLiteral] = None
    validation: LAValidationView
    created_at: str
    published_bundle_ref: Optional[str] = None


class LearnerItemsListResponse(BaseModel):
    items: list[LearnerItemView]


# ---------------------------------------------------------------------------
# Learner-as-author (P3) peer-review request/response models.
#
# A peer records a test+rating with SCALARS ONLY — no free text, no peer
# identity in the body. The peer-signals read is the K-SUPPRESSED teacher view
# (a discriminated status, mirroring class_report's suppressed/ok shape).
# ---------------------------------------------------------------------------


class LearnerPeerReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    passed: bool  # did the peer's self-test of the item pass?
    rating: int = Field(ge=1, le=5)  # 1-5 quality rating.
    helpful: bool  # did the peer mark the item helpful?
    # NO free text, NO peer identity — deliberately absent (extra='forbid').


class LearnerPeerSignalsView(BaseModel):
    """K-suppressed teacher view of an item's peer aggregate.

    ``status='suppressed'`` below the min-raters floor returns only the count +
    floor; ``status='ok'`` returns the four aggregate scalars. Optional fields
    keep one response shape for both branches."""

    status: Literal["ok", "suppressed"]
    n_ratings: int
    min_raters: int
    n_tests: Optional[int] = None
    mean_rating: Optional[float] = None
    helpful_votes: Optional[int] = None
    reason: Optional[str] = None


__all__ = [
    "ABSAsset",
    "ABSAssetType",
    "AICritiqueRubric",
    "AICritiqueScene",
    "AdaptationRule",
    "BibliographicRef",
    "BloomLevel",
    "Bundle",
    "CaseStudy",
    "Claim",
    "CommunicationSimScene",
    "ComparisonScene",
    "Concept",
    "ConceptScene",
    "CritiqueEvalRequest",
    "CritiqueEvalResponse",
    "EnrichmentMetadata",
    "Evidence",
    "ExplainBackScene",
    "FlawClaim",
    "IntroScene",
    "KeyPoint",
    "LADecisionLiteral",
    "LAReviewNoteCodeLiteral",
    "LAReviewStateLiteral",
    "LAValidationView",
    "LearnerDecideRequest",
    "LearnerItemView",
    "LearnerItemsListResponse",
    "LearnerPeerReviewRequest",
    "LearnerPeerSignalsView",
    "LearnerSubmitRequest",
    "LearnerValidateRequest",
    "LearnerValidateResponse",
    "LessonBundle",
    "MetaCheckpointScene",
    "Modulator",
    "PerspicaciteMode",
    "PromptPracticeScene",
    "QuizChoice",
    "QuizScene",
    "ReferenceCheck",
    "ReferenceRun",
    "ReproductionScene",
    "RunManifest",
    "ReproductionStep",
    "RuleAction",
    "RuleActionKind",
    "SCHEMA_VERSION",
    "Scene",
    "SceneType",
    "SceneUnion",
    "SpotTheFlawScene",
    "SummaryAuditScene",
    "SynthesizeOptions",
    "SynthesizeRequest",
    "SynthesizeResponse",
]
