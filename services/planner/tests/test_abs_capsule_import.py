import os
from abs.capsule_import import import_reproduction_subgraph, tier_to_scaffolding
from learning_workflow_schema import LearningWorkflowGraph

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "abs_capsule")


def test_tier_to_scaffolding_mapping():
    assert tier_to_scaffolding("certified") == "light"
    assert tier_to_scaffolding("type-checked") == "light"
    assert tier_to_scaffolding("bypassed") == "moderate"
    assert tier_to_scaffolding("manual-only") == "heavy"
    assert tier_to_scaffolding("experimental") == "exploratory"
    assert tier_to_scaffolding("nonsense") == "moderate"


def test_imports_workflow_concept_and_reproduction_task_nodes():
    nodes, edges = import_reproduction_subgraph(_FIXTURE)
    by_id = {n["id"]: n for n in nodes}
    assert "concept:abs:demo_workflow" in by_id
    t1 = by_id["task:abs:task_001"]
    assert t1["node_kind"] == "task" and t1["scene_type"] == "reproduction"
    assert t1["title"] == "LC-HRMS peak detection"


def test_characterization_reuses_suter_tier_openness():
    nodes, _ = import_reproduction_subgraph(_FIXTURE)
    t1 = next(n for n in nodes if n["id"] == "task:abs:task_001")
    ch = t1["characterization"]
    assert ch["suter"]["coupling"] == "loose"
    assert ch["suter"]["data_transport"] == "file"
    assert ch["reproducibility_tier"] == "type-checked"
    assert ch["task_openness"] == "closed"
    assert ch["scaffolding_level"] == "light"
    t2 = next(n for n in nodes if n["id"] == "task:abs:task_002")
    assert t2["characterization"]["scaffolding_level"] == "moderate"


def test_part_of_and_prerequisite_edges():
    _, edges = import_reproduction_subgraph(_FIXTURE)
    rels = {(e["relation"], e["source"], e["target"]) for e in edges}
    assert ("part_of", "task:abs:task_001", "concept:abs:demo_workflow") in rels
    assert ("part_of", "task:abs:task_002", "concept:abs:demo_workflow") in rels
    assert ("prerequisite_for", "task:abs:task_002", "task:abs:task_001") in rels


def test_subgraph_validates_as_lwg_fragment():
    nodes, edges = import_reproduction_subgraph(_FIXTURE)
    LearningWorkflowGraph.model_validate({"schema_version": "1.0", "course_id": "c", "nodes": nodes, "edges": edges})


def test_missing_capsule_returns_empty():
    nodes, edges = import_reproduction_subgraph("/no/such/dir")
    assert nodes == [] and edges == []
