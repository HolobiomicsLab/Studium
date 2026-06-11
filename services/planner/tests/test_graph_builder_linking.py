"""Tests for GraphBuilder._link_reproduction (Task C3: annotation path).
Follows test_graph_builder_mode_b.py's plan/builder/fixture construction.
"""
import os
from graph.builder import GraphBuilder
from agentic.telemetry import InMemoryTelemetrySink
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, CorpusRef

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "abs_capsule")


class _StubAgent:
    def propose_prerequisites(self, concepts): return []


def _plan_with_concept_and_ref(concept_id, aligns_concept_ids=None):
    return LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45,
        source_manifest_id="sp1",
        learning_objectives=[
            LearningObjective(id=concept_id, description="Understand X", bloom_level="understand")
        ],
        scene_outlines=[
            SceneOutline(id="s1", type="concept", title="X", objective_refs=[concept_id])
        ],
        corpus_refs=[
            CorpusRef(
                ref_id="cap1", ref_type="abs_capsule",
                abs_capsule_path=_FIXTURE,
                aligns_concept_ids=aligns_concept_ids,
            )
        ],
    )


def _builder():
    return GraphBuilder(graph_agent=_StubAgent(), telemetry=InMemoryTelemetrySink(),
                        clock=lambda: "2026-06-11T00:00:00+00:00", asserted_by="urn:x")


def test_annotation_links_reproduction_to_document_concept():
    plan = _plan_with_concept_and_ref("obj-1", aligns_concept_ids=["obj-1"])
    res = _builder().build(plan)
    wf = next(
        n for n in res.graph["nodes"]
        if n["node_kind"] == "concept" and n["id"].startswith("concept:abs:")
    )
    links = [
        e for e in res.graph["edges"]
        if e["relation"] == "prerequisite_for"
        and e["source"] == wf["id"]
        and e["target"] == "concept:obj-1"
    ]
    assert len(links) == 1
    assert links[0]["evidence"][0]["artifact"].startswith("annotation:")
    assert links[0]["confidence"] == 1.0
    assert "quality_flags" not in links[0]  # deterministic annotation link is not flagged


def test_annotation_unknown_concept_is_dropped():
    plan = _plan_with_concept_and_ref("obj-1", aligns_concept_ids=["does-not-exist"])
    res = _builder().build(plan)
    wf = next(
        n for n in res.graph["nodes"]
        if n["node_kind"] == "concept" and n["id"].startswith("concept:abs:")
    )
    links = [
        e for e in res.graph["edges"]
        if e["relation"] == "prerequisite_for"
        and e["source"] == wf["id"]
        and e["target"].startswith("concept:")
        and not e["target"].startswith("concept:abs:")
    ]
    assert links == []
    assert any(
        t.get("event") == "dropped_edge" and t.get("reason") == "unknown_concept"
        for t in res.telemetry
    )
