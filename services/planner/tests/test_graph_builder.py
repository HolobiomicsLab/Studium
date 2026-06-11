from graph.builder import GraphBuilder, GraphBuildResult
from agentic.telemetry import InMemoryTelemetrySink
from learning_workflow_schema import LearningWorkflowGraph
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline


def _plan() -> LessonPlan:
    return LessonPlan(
        id="p1", title="Signal Processing", language="fr", target="L3", duration_minutes=45,
        source_manifest_id="sp101",
        learning_objectives=[
            LearningObjective(id="obj-fourier", description="Understand the Fourier transform", bloom_level="understand"),
            LearningObjective(id="obj-fft", description="Apply the FFT", bloom_level="apply"),
        ],
        scene_outlines=[
            SceneOutline(id="s1", type="concept", title="Fourier basics", objective_refs=["obj-fourier"]),
            SceneOutline(id="s2", type="quiz", title="FFT quiz", objective_refs=["obj-fft"]),
        ],
    )


class _StubAgent:
    def __init__(self, edges): self._edges = edges
    def propose_prerequisites(self, concepts): return self._edges


def _builder(agent, perspicacite=None):
    return GraphBuilder(
        graph_agent=agent, perspicacite=perspicacite, telemetry=InMemoryTelemetrySink(),
        clock=lambda: "2026-06-11T00:00:00+00:00",
        asserted_by="urn:studium:graphagent:sp101",
    )


def test_builds_valid_lwg_with_prerequisite_and_assesses_edges():
    agent = _StubAgent([{"source": "concept:obj-fft", "target": "concept:obj-fourier", "rationale": "FT first"}])
    res = _builder(agent).build(_plan())
    assert isinstance(res, GraphBuildResult)
    LearningWorkflowGraph.model_validate(res.graph)
    assert res.graph["course_id"] == "sp101"
    rels = {(e["relation"], e["source"], e["target"]) for e in res.graph["edges"]}
    assert ("prerequisite_for", "concept:obj-fft", "concept:obj-fourier") in rels
    assert ("assesses", "task:s2", "concept:obj-fft") in rels
    assert len(res.decisions) == 1 and len(res.findings) == 1


def test_ungrounded_edge_is_flagged_not_dropped():
    agent = _StubAgent([{"source": "concept:obj-fft", "target": "concept:obj-fourier"}])
    res = _builder(agent, perspicacite=None).build(_plan())
    edge = next(e for e in res.graph["edges"] if e["relation"] == "prerequisite_for")
    assert edge["quality_flags"]
    assert edge["evidence"][0]["artifact"].startswith("plan:")
    assert edge.get("astra_insight_ref")


def test_dangling_and_self_loop_and_cycle_edges_dropped():
    agent = _StubAgent([
        {"source": "concept:nope", "target": "concept:obj-fft"},
        {"source": "concept:obj-fft", "target": "concept:obj-fft"},
    ])
    res = _builder(agent).build(_plan())
    assert not any(e["relation"] == "prerequisite_for" for e in res.graph["edges"])
    dropped = [r for r in res.telemetry if r.get("event") == "dropped_edge"]
    assert {r["reason"] for r in dropped} >= {"unknown_endpoint", "self_loop"}


def test_grounded_edge_uses_perspicacite_passage():
    class _Persp:
        def search(self, *, query, mode, max_results, kb_names=None):
            return {"status": "ok", "docs": [{"id": "d1", "doi": "10.1/x", "title": "T",
                    "authors": [], "excerpt": "FFT builds on the Fourier transform.", "relevance_score": 0.88}]}
    agent = _StubAgent([{"source": "concept:obj-fft", "target": "concept:obj-fourier"}])
    res = _builder(agent, perspicacite=_Persp()).build(_plan())
    edge = next(e for e in res.graph["edges"] if e["relation"] == "prerequisite_for")
    assert edge["evidence"][0]["doi"] == "10.1/x"
    assert not edge.get("quality_flags")


def test_transitive_cycle_proposal_is_dropped_inside_builder():
    # Stub proposes A->B, B->C, C->A; the third closes a cycle and must be dropped,
    # while the first two are kept. Concepts must exist, so use the two plan concepts
    # plus a third via an extra objective.
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline
    plan = LessonPlan(
        id="p2", title="T", language="fr", target="L3", duration_minutes=45, source_manifest_id="sp2",
        learning_objectives=[
            LearningObjective(id="a", description="A", bloom_level="understand"),
            LearningObjective(id="b", description="B", bloom_level="understand"),
            LearningObjective(id="c", description="C", bloom_level="apply"),
        ],
        scene_outlines=[SceneOutline(id="s1", type="concept", title="s", objective_refs=["a"])],
    )
    agent = _StubAgent([
        {"source": "concept:a", "target": "concept:b"},
        {"source": "concept:b", "target": "concept:c"},
        {"source": "concept:c", "target": "concept:a"},  # closes the cycle
    ])
    res = _builder(agent).build(plan)
    prereqs = {(e["source"], e["target"]) for e in res.graph["edges"] if e["relation"] == "prerequisite_for"}
    assert ("concept:a", "concept:b") in prereqs
    assert ("concept:b", "concept:c") in prereqs
    assert ("concept:c", "concept:a") not in prereqs
    assert any(r.get("event") == "dropped_edge" and r.get("reason") == "cycle" for r in res.telemetry)
