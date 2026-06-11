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


# ---------------------------------------------------------------------------
# Task C4: semantic fallback tests
# ---------------------------------------------------------------------------

class _StubPersp:
    """Returns a high relevance when hot_title appears in the query, low otherwise."""
    def __init__(self, hot_title):
        self._hot = hot_title

    def search(self, *, query, mode, max_results, kb_names=None):
        score = 0.9 if self._hot in query else 0.1
        return {"status": "ok", "docs": [{"relevance_score": score, "excerpt": "ev", "id": "d1"}]}


class _StubPerspAllHot:
    """Returns score 0.9 for every query (all concepts above threshold)."""
    def search(self, *, query, mode, max_results, kb_names=None):
        return {"status": "ok", "docs": [{"relevance_score": 0.9, "excerpt": "ev", "id": "d1"}]}


def _plan_no_annotation(*concept_ids):
    """Build a plan with the given concept ids (as LearningObjectives) and one abs_capsule
    corpus_ref without aligns_concept_ids, so the semantic fallback is triggered."""
    objectives = [
        LearningObjective(id=cid, description=f"Understand {cid}", bloom_level="understand")
        for cid in concept_ids
    ]
    scenes = [
        SceneOutline(id=f"s{i}", type="concept", title=cid, objective_refs=[cid])
        for i, cid in enumerate(concept_ids)
    ]
    return LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45,
        source_manifest_id="sp1",
        learning_objectives=objectives,
        scene_outlines=scenes,
        corpus_refs=[
            CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path=_FIXTURE)
        ],
    )


def _builder_with_persp(persp):
    return GraphBuilder(graph_agent=_StubAgent(), perspicacite=persp,
                        telemetry=InMemoryTelemetrySink(),
                        clock=lambda: "2026-06-11T00:00:00+00:00", asserted_by="urn:x")


def test_semantic_fallback_links_above_threshold_flagged_auto():
    """Perspicacité hot for 'Fourier' concept -> one auto_linked prereq edge to that concept only."""
    plan = _plan_no_annotation("obj-1", "obj-2")
    # Make obj-1's title contain 'Fourier' by giving it that description;
    # the stub matches on the concept title in the query.
    # The concept title comes from the LearningObjective description -> objective_id.
    # concept_title is derived from the node title (which comes from objective id via derive_base_graph).
    # We use concept ids that match the stub's hot_title string.
    plan2 = LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45,
        source_manifest_id="sp1",
        learning_objectives=[
            LearningObjective(id="obj-fourier", description="Fourier transforms", bloom_level="understand"),
            LearningObjective(id="obj-trees", description="Trees data structure", bloom_level="understand"),
        ],
        scene_outlines=[
            SceneOutline(id="s1", type="concept", title="Fourier", objective_refs=["obj-fourier"]),
            SceneOutline(id="s2", type="concept", title="Trees", objective_refs=["obj-trees"]),
        ],
        corpus_refs=[
            CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path=_FIXTURE)
        ],
    )
    res = _builder_with_persp(_StubPersp("Fourier")).build(plan2)
    wf = next(n for n in res.graph["nodes"]
              if n["node_kind"] == "concept" and n["id"].startswith("concept:abs:"))
    links = [e for e in res.graph["edges"]
             if e["relation"] == "prerequisite_for"
             and e["source"] == wf["id"]
             and e["target"].startswith("concept:")
             and not e["target"].startswith("concept:abs:")]
    assert len(links) == 1
    assert links[0]["target"] == "concept:obj-fourier"
    assert "auto_linked" in links[0]["quality_flags"]
    assert any(f for f in res.findings)  # an insight was emitted for the inferred link


def test_semantic_fallback_no_persp_no_link():
    """No Perspicacité instance, no annotation -> no link edge (honest)."""
    plan = _plan_no_annotation("obj-1", "obj-2")
    res = _builder().build(plan)  # _builder() has no perspicacite
    wf = next(n for n in res.graph["nodes"]
              if n["node_kind"] == "concept" and n["id"].startswith("concept:abs:"))
    links = [e for e in res.graph["edges"]
             if e["relation"] == "prerequisite_for"
             and e["source"] == wf["id"]
             and not e["target"].startswith("concept:abs:")]
    assert links == []


def test_semantic_fallback_caps_at_top_3():
    """Five concepts all scoring >= 0.5 -> at most 3 link edges."""
    plan5 = _plan_no_annotation("c1", "c2", "c3", "c4", "c5")
    res = _builder_with_persp(_StubPerspAllHot()).build(plan5)
    wf = next(n for n in res.graph["nodes"]
              if n["node_kind"] == "concept" and n["id"].startswith("concept:abs:"))
    links = [e for e in res.graph["edges"]
             if e["relation"] == "prerequisite_for"
             and e["source"] == wf["id"]
             and not e["target"].startswith("concept:abs:")]
    assert len(links) <= 3


# ---------------------------------------------------------------------------
# BUG 1 regression: duplicate aligns_concept_ids must emit exactly ONE edge
# ---------------------------------------------------------------------------

def test_annotation_dedups_duplicate_concept_ids():
    """aligns_concept_ids=['obj-1','obj-1'] must produce exactly ONE prerequisite_for link
    to concept:obj-1 (no duplicate edge ids)."""
    plan = _plan_with_concept_and_ref("obj-1", aligns_concept_ids=["obj-1", "obj-1"])
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
    # Edge ids must also be unique across the whole graph
    all_edge_ids = [e["id"] for e in res.graph["edges"]]
    assert len(all_edge_ids) == len(set(all_edge_ids)), "duplicate edge ids detected"
