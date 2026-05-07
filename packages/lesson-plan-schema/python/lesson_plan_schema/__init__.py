from __future__ import annotations
from enum import Enum
from typing import Optional
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


class SceneOutline(BaseModel):
    id: str = Field(min_length=1)
    type: SceneType
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1)
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
