import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

import pytest
from pydantic import ValidationError
from learning_workflow_schema import LearningWorkflowGraph, ConceptNode, GraphEdge

FIXTURE = {
    "schema_version": "1.0",
    "course_id": "signal-processing-101",
    "nodes": [
        {"id": "concept:fourier-basics", "node_kind": "concept", "title": "Fourier basics", "bloom_level": "understand"},
        {"id": "concept:fft", "node_kind": "concept", "title": "FFT", "bloom_level": "apply"},
        {"id": "task:quiz-fft", "node_kind": "task", "title": "FFT quiz", "scene_type": "quiz", "objective_refs": ["obj:fft-1"]},
    ],
    "edges": [
        {"id": "e1", "relation": "prerequisite_for", "source": "concept:fft", "target": "concept:fourier-basics"},
        {"id": "e2", "relation": "assesses", "source": "task:quiz-fft", "target": "concept:fft", "objective_id": "obj:fft-1", "bloom_level": "apply"},
    ],
}


def test_accepts_well_formed_graph():
    g = LearningWorkflowGraph.model_validate(FIXTURE)
    assert g.course_id == "signal-processing-101"
    assert len(g.nodes) == 3 and len(g.edges) == 2


def test_rejects_unknown_relation():
    bad = {**FIXTURE, "edges": [{"id": "e3", "relation": "causes", "source": "a", "target": "b"}]}
    with pytest.raises(ValidationError):
        LearningWorkflowGraph.model_validate(bad)


def test_rejects_unknown_node_kind():
    bad = {**FIXTURE, "nodes": [{"id": "x", "node_kind": "module", "title": "X"}]}
    with pytest.raises(ValidationError):
        LearningWorkflowGraph.model_validate(bad)


# FIX M2 — constraint tests

def test_rejects_edge_confidence_out_of_range():
    """confidence: 1.5 is outside the 0..1 range."""
    bad = {**FIXTURE, "edges": [
        {"id": "e-bad", "relation": "prerequisite_for", "source": "a", "target": "b", "confidence": 1.5}
    ]}
    with pytest.raises(ValidationError):
        LearningWorkflowGraph.model_validate(bad)


def test_rejects_node_with_empty_id():
    """Empty id string must be rejected (min_length=1)."""
    bad = {**FIXTURE, "nodes": [
        {"id": "", "node_kind": "concept", "title": "Fourier basics", "bloom_level": "understand"}
    ]}
    with pytest.raises(ValidationError):
        LearningWorkflowGraph.model_validate(bad)


def test_rejects_concept_node_with_invalid_bloom_level():
    """bloom_level: 'mastery' is not a valid BloomLevel."""
    with pytest.raises(ValidationError):
        ConceptNode(id="c1", node_kind="concept", title="X", bloom_level="mastery")  # type: ignore[arg-type]


def test_rejects_wrong_schema_version():
    """schema_version: '2.0' does not match Literal['1.0']."""
    bad = {**FIXTURE, "schema_version": "2.0"}
    with pytest.raises(ValidationError):
        LearningWorkflowGraph.model_validate(bad)
