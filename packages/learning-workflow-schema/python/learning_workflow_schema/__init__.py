from __future__ import annotations
from typing import Annotated, Literal, Optional, Union
from pydantic import BaseModel, Field, model_validator

BloomLevel = Literal["remember", "understand", "apply", "analyze", "evaluate", "create"]
KnowledgeDimension = Literal["factual", "conceptual", "procedural", "metacognitive"]
SceneType = Literal[
    "intro", "concept", "quiz", "simulation", "reproduction", "discussion", "meta_checkpoint", "ai_critique",
    # active-learning task nodes:
    "spot_the_flaw", "explain_back",
    # active-learning wave-1: comparison / summary_audit / prompt_practice.
    "comparison", "summary_audit", "prompt_practice",
    # active-learning wave-2 (D2): simulate a professional communication situation.
    "communication_sim",
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


class GraphEvidence(BaseModel):
    doi: Optional[str] = None
    artifact: Optional[str] = None
    quote: Optional[str] = None
    page: Optional[int] = None
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    decision_context: Optional[list[str]] = None


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
    evidence: Optional[list[GraphEvidence]] = None


class LearningWorkflowGraph(BaseModel):
    schema_version: Literal["1.0"]
    course_id: str = Field(min_length=1)
    nodes: list[GraphNode]
    edges: list[GraphEdge]

    @model_validator(mode="after")
    def _unique_ids(self) -> "LearningWorkflowGraph":
        node_ids = [n.id for n in self.nodes]
        seen: set[str] = set()
        for nid in node_ids:
            if nid in seen:
                raise ValueError(f"duplicate node id: {nid}")
            seen.add(nid)
        edge_ids = [e.id for e in self.edges]
        seen = set()
        for eid in edge_ids:
            if eid in seen:
                raise ValueError(f"duplicate edge id: {eid}")
            seen.add(eid)
        return self


def validate_graph(data: dict) -> dict:
    """Validate a graph dict. Returns {'valid': bool, 'errors': list[str]}."""
    from pydantic import ValidationError
    try:
        LearningWorkflowGraph.model_validate(data)
        return {"valid": True, "errors": []}
    except ValidationError as exc:
        return {"valid": False, "errors": [str(e["msg"]) for e in exc.errors()]}
