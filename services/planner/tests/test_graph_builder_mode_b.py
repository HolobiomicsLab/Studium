import os
from graph.builder import GraphBuilder
from agentic.telemetry import InMemoryTelemetrySink
from learning_workflow_schema import LearningWorkflowGraph
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, CorpusRef

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "abs_capsule")


class _StubAgent:
    def propose_prerequisites(self, concepts): return []


def _plan(corpus_refs):
    return LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45, source_manifest_id="sp1",
        learning_objectives=[LearningObjective(id="o1", description="Understand X", bloom_level="understand")],
        scene_outlines=[SceneOutline(id="s1", type="concept", title="X", objective_refs=["o1"])],
        corpus_refs=corpus_refs,
    )


def _builder():
    return GraphBuilder(graph_agent=_StubAgent(), telemetry=InMemoryTelemetrySink(),
                        clock=lambda: "2026-06-11T00:00:00+00:00", asserted_by="urn:x")


def test_mode_b_merges_reproduction_subgraph_from_corpus_ref():
    plan = _plan([CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path=_FIXTURE)])
    res = _builder().build(plan)
    LearningWorkflowGraph.model_validate(res.graph)
    ids = {n["id"] for n in res.graph["nodes"]}
    assert "concept:abs:demo_workflow" in ids and "task:abs:task_001" in ids
    repro = next(n for n in res.graph["nodes"] if n["id"] == "task:abs:task_001")
    assert repro["characterization"]["reproducibility_tier"] == "type-checked"
    rels = {(e["relation"], e["source"], e["target"]) for e in res.graph["edges"]}
    assert ("prerequisite_for", "task:abs:task_002", "task:abs:task_001") in rels


def test_mode_a_only_when_no_capsule_ref():
    res = _builder().build(_plan([]))
    assert not any(n["id"].startswith("task:abs:") for n in res.graph["nodes"])


def test_missing_capsule_path_is_best_effort():
    plan = _plan([CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path="/no/such/dir")])
    res = _builder().build(plan)
    assert not any(n["id"].startswith("concept:abs:") for n in res.graph["nodes"])
