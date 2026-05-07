"""Planner service Pydantic schemas — aligned with lesson-plan-schema v1 (ADR 003)."""
from __future__ import annotations
import sys, os
import uuid as _uuid
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../packages/lesson-plan-schema/python"))

from lesson_plan_schema import (
    LessonPlan,
    LearningObjective,
    SceneOutline,
    CorpusRef,
    PlanMetadata,
    BloomLevel,
    SceneType,
    PlanStatus,
    RefType,
)
from pydantic import BaseModel, Field
from typing import Optional


class PlanRequest(BaseModel):
    """Input to the planner: corpus manifest + pedagogical constraints."""
    manifest_id: str
    target: str = Field(min_length=1, description="Target audience (e.g. L3, M1)")
    duration_minutes: int = Field(default=45, ge=1)
    language: str = Field(default="fr", min_length=2)
    keywords: Optional[str] = None
    corpus_refs: list[CorpusRef] = Field(default_factory=list)
    text_preview: Optional[str] = None


class PlanResponse(BaseModel):
    """Output of the planner: lesson plan + critic score."""
    lesson_plan: LessonPlan
    critic_score: float = Field(ge=0.0, le=1.0)
    critic_annotations: list[str] = Field(default_factory=list)


class CritiqueResult(BaseModel):
    """Résultat structuré du CriticAgent (rule 002 + rule 003)."""
    score: float = Field(ge=0.0, le=1.0)
    annotations: list[str] = Field(default_factory=list)
    bloom_consistency: bool = True
    ontology_warnings: list[str] = Field(default_factory=list)
    prov_activity_uri: str = Field(
        default_factory=lambda: f"urn:studium:activity:critic:{_uuid.uuid4().hex[:8]}"
    )


__all__ = [
    "LessonPlan", "LearningObjective", "SceneOutline", "CorpusRef",
    "PlanMetadata", "BloomLevel", "SceneType", "PlanStatus", "RefType",
    "PlanRequest", "PlanResponse", "CritiqueResult",
]
