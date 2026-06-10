from __future__ import annotations
from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, Field

BloomLevel = Literal["remember", "understand", "apply", "analyze", "evaluate", "create"]
KnowledgeDimension = Literal["factual", "conceptual", "procedural", "metacognitive"]
SceneType = Literal[
    "intro", "concept", "quiz", "simulation", "reproduction", "discussion", "meta_checkpoint", "ai_critique"
]
EdgeRelation = Literal["prerequisite_for", "part_of", "decomposes_into", "assesses", "aligns_with"]
ReproducibilityTier = Literal["certified", "type-checked", "bypassed", "manual-only", "experimental"]
TaskOpenness = Literal["closed", "open", "mixed"]


class SuterAxes(BaseModel):
    coupling: Literal["tight", "loose", "ad_hoc"]
    composition_modularity: Literal["flat", "hierarchical"]
    abstraction_level: Literal["abstract", "intermediate", "concrete", "implicit"]
    orchestration_planning: Literal["static", "dynamic", "event_driven"]
    data_transport: Literal["file", "streaming", "in_memory"]


class WorkflowCharacterization(BaseModel):
    suter: SuterAxes
    reproducibility_tier: ReproducibilityTier
    task_openness: TaskOpenness
    scaffolding_level: Optional[Literal["light", "moderate", "heavy", "exploratory"]] = None


class ConceptNode(BaseModel):
    id: str = Field(min_length=1)
    node_kind: Literal["concept"]
    title: str = Field(min_length=1)
    bloom_level: BloomLevel
    knowledge_dimension: Optional[KnowledgeDimension] = None
    description: Optional[str] = None


class TaskNode(BaseModel):
    id: str = Field(min_length=1)
    node_kind: Literal["task"]
    title: str = Field(min_length=1)
    scene_type: SceneType
    objective_refs: Optional[list[str]] = None
    characterization: Optional[WorkflowCharacterization] = None


GraphNode = Annotated[Union[ConceptNode, TaskNode], Field(discriminator="node_kind")]


class GraphEdge(BaseModel):
    id: str = Field(min_length=1)
    relation: EdgeRelation
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    objective_id: Optional[str] = None
    bloom_level: Optional[BloomLevel] = None
    aligns_uri: Optional[str] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    quality_flags: Optional[list[str]] = None
    astra_insight_ref: Optional[str] = None


class LearningWorkflowGraph(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    course_id: str = Field(min_length=1)
    nodes: list[GraphNode]
    edges: list[GraphEdge]
