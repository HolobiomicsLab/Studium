"""Pydantic mirror of lesson-schema v1 (ADR 003)."""
from __future__ import annotations

from enum import Enum
from typing import Any, Union
from pydantic import BaseModel, Field, model_validator


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


class Modulator(str, Enum):
    M1 = "M1"
    M2 = "M2"
    M3 = "M3"
    M4 = "M4"
    M5 = "M5"
    M6 = "M6"


class AdaptationHook(str, Enum):
    on_error = "on_error"
    on_low_confidence = "on_low_confidence"
    on_high_confidence = "on_high_confidence"
    on_timeout = "on_timeout"
    on_revisit = "on_revisit"


class LearningObjective(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(min_length=1)
    description: str = Field(min_length=1)
    bloom_level: BloomLevel


class Scene(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(min_length=1)
    type: SceneType
    objective_refs: list[str]
    modulators: list[Modulator]
    content: dict[str, Any]
    success_criteria: Union[str, list[str]]
    adaptation_hooks: list[AdaptationHook]
    composite: bool = False
    secondary_objectives: list[str] = Field(default_factory=list)


class Metadata(BaseModel):
    model_config = {"extra": "allow"}

    subject: str
    author: str
    created: str
    tags: list[str] = Field(default_factory=list)
    version: str | None = None


class Lesson(BaseModel):
    model_config = {"extra": "forbid"}

    schema_version: str = Field(pattern=r"^1\.0$")
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    language: str = Field(min_length=2)
    learning_objectives: list[LearningObjective] = Field(min_length=1)
    scenes: list[Scene] = Field(min_length=1)
    metadata: Metadata

    @model_validator(mode="after")
    def validate_objective_refs(self) -> "Lesson":
        obj_ids = {o.id for o in self.learning_objectives}
        for scene in self.scenes:
            for ref in scene.objective_refs:
                if ref not in obj_ids:
                    raise ValueError(f"Scene '{scene.id}' references unknown objective '{ref}'")
        return self
