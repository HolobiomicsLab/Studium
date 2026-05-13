import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../packages/lesson-plan-schema/python"))

import pytest


def _sample_plan():
    from lesson_plan_schema import (
        LessonPlan, LearningObjective, SceneOutline,
        CorpusRef, BloomLevel, SceneType, RefType, PlanStatus
    )
    return LessonPlan(
        schema_version="1.0",
        id="plan-prov-test",
        title="Test provenance",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(
                id="obj-1", description="Comprendre LC-MS",
                bloom_level=BloomLevel.understand,
                bloom_uri="urn:studium:bloom:understand",
                edam_operation="http://edamontology.org/operation_3214",
            )
        ],
        scene_outlines=[
            SceneOutline(
                id="sc-1", type=SceneType.reproduction,
                title="TP LC-MS", objective_refs=["obj-1"],
                abs_task_card_id="task_001",
                prov_derived_from=["doi:10.1073/pnas.1319030111"],
            )
        ],
        corpus_refs=[
            CorpusRef(
                ref_id="ref-1", ref_type=RefType.doi,
                doi="10.1073/pnas.1319030111",
                prov_entity_uri="doi:10.1073/pnas.1319030111",
            )
        ],
        prov_entity_uri="urn:studium:plan:plan-prov-test",
        prov_derived_from=["doi:10.1073/pnas.1319030111"],
        prov_generated_by="urn:studium:activity:planner:run-001",
        dct_subject="Métabolomique",
        dct_language="fr",
    )


def _sample_audit():
    return {
        "provider": "mock",
        "alias": "studium/planner",
        "latency_s": 0.1,
        "attempt": 1,
        "status": "ok",
    }


def _sample_critique():
    from planner_schemas import CritiqueResult
    return CritiqueResult(
        score=0.8,
        annotations=["Plan cohérent"],
        bloom_consistency=True,
        ontology_warnings=[],
        prov_activity_uri="urn:studium:activity:critic:run-001",
    )


def test_build_prov_graph_returns_dict():
    from ontology.prov import build_prov_graph
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    assert isinstance(graph, dict)
    assert "@context" in graph
    assert "@graph" in graph


def test_prov_graph_has_all_namespaces():
    from ontology.prov import build_prov_graph
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    ctx = graph["@context"]
    for ns in ["prov", "skos", "esco", "schema", "dct", "edam", "repme"]:
        assert ns in ctx, f"namespace '{ns}' manquant dans @context"


def test_prov_graph_plan_entity():
    from ontology.prov import build_prov_graph
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    ids = [n.get("@id") for n in graph["@graph"]]
    assert "urn:studium:plan:plan-prov-test" in ids


def test_prov_graph_derived_from():
    from ontology.prov import build_prov_graph
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    plan_node = next(n for n in graph["@graph"] if n.get("@id") == "urn:studium:plan:plan-prov-test")
    derived = plan_node.get("prov:wasDerivedFrom", [])
    assert any(d.get("@id") == "doi:10.1073/pnas.1319030111" for d in derived)


def test_prov_graph_planner_activity():
    from ontology.prov import build_prov_graph
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    ids = [n.get("@id") for n in graph["@graph"]]
    assert "urn:studium:activity:planner:run-001" in ids


def test_serialize_jsonld_returns_string():
    from ontology.prov import build_prov_graph
    from ontology.jsonld import serialize_jsonld
    graph = build_prov_graph(_sample_plan(), {}, _sample_audit(), _sample_critique())
    s = serialize_jsonld(graph)
    assert isinstance(s, str)
    assert '"@context"' in s


def test_prov_graph_includes_enrichment_activity_when_evidence_present():
    """Si une scène a evidence, le graphe Prov-O inclut enrichment_activity."""
    from datetime import datetime, timezone
    from ontology.prov import build_prov_graph
    from lesson_plan_schema import (
        LessonPlan, LearningObjective, SceneOutline,
        BloomLevel, SceneType, Evidence, EnrichmentMetadata,
    )

    plan = LessonPlan(
        schema_version="1.0",
        id="plan-enrich-1",
        title="T",
        target="L3",
        duration_minutes=45,
        language="fr",
        learning_objectives=[
            LearningObjective(
                id="o1",
                description="comprendre",
                bloom_level=BloomLevel.understand,
            )
        ],
        scene_outlines=[
            SceneOutline(
                id="s1",
                type=SceneType.concept,
                title="c",
                evidence=Evidence(
                    enrichment_metadata=EnrichmentMetadata(
                        enricher_version="1.0",
                        perspicacite_mode_used="advanced",
                        timestamp=datetime.now(timezone.utc).isoformat(),
                        degraded=False,
                    )
                ),
            )
        ],
        corpus_refs=[],
    )

    graph = build_prov_graph(plan, manifest=None, planner_audit=None, critique=None)
    nodes_str = str(graph)
    assert "enrichment" in nodes_str.lower()


def test_prov_graph_no_enrichment_activity_when_no_evidence():
    """Sans evidence → pas de node enrichment_activity."""
    from ontology.prov import build_prov_graph
    from lesson_plan_schema import (
        LessonPlan, LearningObjective, SceneOutline,
        BloomLevel, SceneType,
    )

    plan = LessonPlan(
        schema_version="1.0",
        id="plan-enrich-2",
        title="T",
        target="L3",
        duration_minutes=45,
        language="fr",
        learning_objectives=[
            LearningObjective(
                id="o1",
                description="comprendre",
                bloom_level=BloomLevel.understand,
            )
        ],
        scene_outlines=[
            SceneOutline(id="s1", type=SceneType.concept, title="c")
        ],
        corpus_refs=[],
    )

    graph = build_prov_graph(plan, manifest=None, planner_audit=None, critique=None)
    nodes_str = str(graph)
    assert "enrichment" not in nodes_str.lower()
