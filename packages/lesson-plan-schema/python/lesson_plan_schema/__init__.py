from __future__ import annotations
from enum import Enum
from typing import Any, Optional, Literal
from pydantic import BaseModel, Field


class BloomLevel(str, Enum):
    remember = "remember"
    understand = "understand"
    apply = "apply"
    analyze = "analyze"
    evaluate = "evaluate"
    create = "create"


class SceneType(str, Enum):
    intro = "intro"
    concept = "concept"
    quiz = "quiz"
    simulation = "simulation"
    reproduction = "reproduction"
    discussion = "discussion"
    meta_checkpoint = "meta_checkpoint"
    ai_critique = "ai_critique"
    # capsule-grounded JUDGMENT scene (audit a flawed AI reading of a REAL executed
    # result). The planner can request it; the composer runs the capsule + attaches the
    # verified reference_result. Mirrors scene_synth_schemas.SceneType (the bundle vocab).
    spot_the_flaw = "spot_the_flaw"


class PlanStatus(str, Enum):
    draft = "draft"
    critic_reviewed = "critic_reviewed"
    approved = "approved"


class RefType(str, Enum):
    local_file = "local_file"
    doi = "doi"
    url = "url"
    offline = "offline"
    abs_capsule = "abs_capsule"


class Concept(BaseModel):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    bloom_level_target: BloomLevel


class LearningObjective(BaseModel):
    id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    bloom_level: BloomLevel
    # Concept disciplinaire
    concept_uris: Optional[list[str]] = None
    skos_concept_uri: Optional[str] = None
    skos_broader: Optional[str] = None
    skos_related: Optional[list[str]] = None
    # Compétence
    esco_skill_uri: Optional[str] = None
    esco_knowledge_uri: Optional[str] = None
    case_item_uri: Optional[str] = None
    # EDAM (depuis ABS SciSkill)
    edam_operation: Optional[str] = None
    edam_topics: Optional[list[str]] = None
    # Alignement curriculaire
    schema_alignment_uri: Optional[str] = None
    bloom_uri: Optional[str] = None


class BibliographicRef(BaseModel):
    perspicacite_doc_id: str = Field(min_length=1)
    doi: Optional[str] = None
    title: str = Field(min_length=1)
    authors: list[str]
    year: Optional[int] = None
    excerpt: str = Field(max_length=500)
    relevance_score: float = Field(ge=0.0, le=1.0)
    prov_derived_from: str = Field(min_length=1)


class CaseStudy(BaseModel):
    title: str = Field(min_length=1)
    summary: str = Field(max_length=1000)
    source_refs: list[str]


class ABSAsset(BaseModel):
    asset_type: Literal[
        "spectrum_viewer_svg",
        "code_snippet",
        "data_csv",
        "protocol_card_md",
        "script_snippet",
    ]
    payload_inline: Optional[str] = None
    payload_path: Optional[str] = None
    abs_task_card_id: Optional[str] = None
    prov_derived_from: str = Field(min_length=1)


class EnrichmentMetadata(BaseModel):
    enricher_version: str = Field(min_length=1)
    perspicacite_mode_used: Literal["basic", "advanced", "profound", "agentic", "passages"]
    timestamp: str = Field(min_length=1)
    degraded: bool


class Evidence(BaseModel):
    bibliographic_refs: Optional[list[BibliographicRef]] = None
    case_studies: Optional[list[CaseStudy]] = None
    abs_asset: Optional[ABSAsset] = None
    enrichment_metadata: EnrichmentMetadata


class SceneOutline(BaseModel):
    id: str = Field(min_length=1)
    type: SceneType
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1)
    evidence: Optional[Evidence] = None
    evidence_override: Optional[Literal["force", "skip"]] = None
    # Ontologie
    skos_concept_uris: Optional[list[str]] = None
    dct_subject: Optional[str] = None
    prov_derived_from: Optional[list[str]] = None
    dct_references: Optional[list[str]] = None
    schema_educational_alignment: Optional[list[str]] = None
    case_item_uri: Optional[str] = None
    # ABS
    abs_task_card_id: Optional[str] = None


class CorpusRef(BaseModel):
    ref_id: str = Field(min_length=1)
    ref_type: RefType
    title: Optional[str] = None
    doi: Optional[str] = None
    file_path: Optional[str] = None
    resolved: Optional[bool] = None
    # Provenance
    prov_entity_uri: Optional[str] = None
    dct_source: Optional[str] = None
    dct_references: Optional[list[str]] = None
    skos_subject: Optional[str] = None
    # ABS capsule
    abs_capsule_path: Optional[str] = None
    abs_task_card_ids: Optional[list[str]] = None
    # Doc-concept linking (sub-project C): document concept ids this capsule's reproduction
    # applies/requires (without the `concept:` prefix; the GraphBuilder prefixes). Deterministic
    # link source when present; absent -> GraphBuilder may fall back to semantic matching.
    aligns_concept_ids: Optional[list[str]] = None


class PlanMetadata(BaseModel):
    subject: str
    author: str
    created: str
    tags: Optional[list[str]] = None

    model_config = {"extra": "allow"}


class LessonPlan(BaseModel):
    schema_version: str = Field(default="1.0", pattern="^1\\.0$")
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    language: str = Field(min_length=2)
    target: str = Field(min_length=1)
    duration_minutes: int = Field(ge=1)
    learning_objectives: list[LearningObjective] = Field(min_length=1)
    scene_outlines: list[SceneOutline] = Field(min_length=1)
    concepts: list[Concept] = Field(default_factory=list)
    corpus_refs: list[CorpusRef] = Field(default_factory=list)
    critic_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    critic_annotations: Optional[list[str]] = None
    status: PlanStatus = PlanStatus.draft
    validated_by: Optional[str] = None
    metadata: Optional[PlanMetadata] = None
    # Provenance Prov-O
    prov_entity_uri: Optional[str] = None
    prov_derived_from: Optional[list[str]] = None
    prov_generated_by: Optional[str] = None
    # Curriculum
    schema_course_uri: Optional[str] = None
    schema_educational_level: Optional[str] = None
    dct_subject: Optional[str] = None
    dct_language: Optional[str] = None
    # Compétences cibles
    esco_occupation_uri: Optional[str] = None
    case_framework_uri: Optional[str] = None
    # Manifest source (set by planner from PlanRequest.manifest_id; used for per-course KB routing)
    source_manifest_id: Optional[str] = None
    learning_workflow_graph: Optional[dict[str, Any]] = None
    universes: Optional[dict[str, Any]] = None
