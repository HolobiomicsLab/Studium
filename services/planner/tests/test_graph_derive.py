from graph.derive import derive_base_graph
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline


def _plan() -> LessonPlan:
    return LessonPlan(
        id="p1", title="Signal Processing", language="fr", target="L3", duration_minutes=45,
        learning_objectives=[
            LearningObjective(id="obj-fourier", description="Understand the Fourier transform", bloom_level="understand"),
            LearningObjective(id="obj-fft", description="Apply the FFT", bloom_level="apply"),
        ],
        scene_outlines=[
            SceneOutline(id="s1", type="concept", title="Fourier basics", objective_refs=["obj-fourier"]),
            SceneOutline(id="s2", type="quiz", title="FFT quiz", objective_refs=["obj-fft"]),
        ],
    )


def test_concepts_from_objectives_and_tasks_from_scenes():
    nodes, edges = derive_base_graph(_plan())
    concepts = {n["id"]: n for n in nodes if n["node_kind"] == "concept"}
    tasks = {n["id"]: n for n in nodes if n["node_kind"] == "task"}
    assert concepts["concept:obj-fft"]["bloom_level"] == "apply"
    assert concepts["concept:obj-fourier"]["title"] == "Understand the Fourier transform"
    assert tasks["task:s2"]["scene_type"] == "quiz"
    assert tasks["task:s1"]["objective_refs"] == ["obj-fourier"]


def test_assesses_edges_link_task_to_concept_with_bloom():
    _, edges = derive_base_graph(_plan())
    a = next(e for e in edges if e["id"] == "assesses:s2:obj-fft")
    assert a["relation"] == "assesses"
    assert a["source"] == "task:s2" and a["target"] == "concept:obj-fft"
    assert a["objective_id"] == "obj-fft" and a["bloom_level"] == "apply"


def test_assesses_skips_dangling_objective_refs():
    p = _plan()
    p.scene_outlines.append(SceneOutline(id="s3", type="intro", title="x", objective_refs=["nope"]))
    _, edges = derive_base_graph(p)
    assert not any(e["id"] == "assesses:s3:nope" for e in edges)
