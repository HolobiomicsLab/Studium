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


class LearningObjective(BaseModel):
    id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    bloom_level: BloomLevel


class SceneOutline(BaseModel):
    id: str = Field(min_length=1)
    type: SceneType
    title: str = Field(min_length=1)
    objective_refs: list[str] = Field(default_factory=list)
    notes: Optional[str] = None
    duration_minutes: Optional[int] = Field(default=None, ge=1)


class CorpusRef(BaseModel):
    ref_id: str = Field(min_length=1)
    ref_type: RefType
    title: Optional[str] = None
    doi: Optional[str] = None
    file_path: Optional[str] = None
    resolved: Optional[bool] = None


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
