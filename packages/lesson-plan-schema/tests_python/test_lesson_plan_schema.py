import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

import pytest
from pydantic import ValidationError
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, CorpusRef, PlanMetadata


SAMPLE = {
    "schema_version": "1.0",
    "id": "plan-001",
    "title": "Introduction à la métabolomique",
    "language": "fr",
    "target": "L3",
    "duration_minutes": 45,
    "learning_objectives": [
        {"id": "obj-1", "description": "Comprendre les bases", "bloom_level": "understand"}
    ],
    "scene_outlines": [
        {"id": "sc-1", "type": "intro", "title": "Intro", "objective_refs": ["obj-1"]},
        {"id": "sc-2", "type": "concept", "title": "Concepts", "objective_refs": ["obj-1"]},
    ],
    "corpus_refs": [
        {"ref_id": "ref-1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}
    ],
    "status": "draft",
    "metadata": {"subject": "Métabolomique", "author": "Prof. Dupont", "created": "2026-05-05"},
}


def test_lesson_plan_accepts_sample():
    plan = LessonPlan(**SAMPLE)
    assert plan.id == "plan-001"
    assert plan.status.value == "draft"
    assert len(plan.learning_objectives) == 1
    assert len(plan.scene_outlines) == 2


def test_lesson_plan_rejects_empty():
    with pytest.raises(ValidationError):
        LessonPlan()


def test_lesson_plan_rejects_invalid_bloom():
    bad = {**SAMPLE, "learning_objectives": [
        {"id": "o1", "description": "x", "bloom_level": "unknown_level"}
    ]}
    with pytest.raises(ValidationError):
        LessonPlan(**bad)


def test_lesson_plan_rejects_invalid_status():
    bad = {**SAMPLE, "status": "published"}
    with pytest.raises(ValidationError):
        LessonPlan(**bad)


def test_critic_score_bounds():
    plan = LessonPlan(**{**SAMPLE, "critic_score": 0.85, "status": "critic_reviewed"})
    assert plan.critic_score == 0.85

    with pytest.raises(ValidationError):
        LessonPlan(**{**SAMPLE, "critic_score": 1.5})


def test_corpus_ref_optional_ontology_fields():
    from lesson_plan_schema import CorpusRef, RefType
    ref = CorpusRef(
        ref_id="ref-abs-1",
        ref_type=RefType.abs_capsule,
        prov_entity_uri="urn:studium:corpus:abs-1",
        dct_source="file:///capsules/task_001",
        abs_capsule_path="/capsules/task_001",
        abs_task_card_ids=["task_001"],
    )
    assert ref.ref_type == RefType.abs_capsule
    assert ref.prov_entity_uri == "urn:studium:corpus:abs-1"
    assert ref.abs_capsule_path == "/capsules/task_001"


def test_learning_objective_optional_ontology_fields():
    from lesson_plan_schema import LearningObjective, BloomLevel
    obj = LearningObjective(
        id="obj-1",
        description="Comprendre LC-MS",
        bloom_level=BloomLevel.understand,
        skos_concept_uri="http://edamontology.org/topic_0121",
        esco_skill_uri="http://data.europa.eu/esco/skill/abc123",
        bloom_uri="urn:studium:bloom:understand",
        edam_operation="http://edamontology.org/operation_3214",
        edam_topics=["http://edamontology.org/topic_0121"],
    )
    assert obj.skos_concept_uri == "http://edamontology.org/topic_0121"
    assert obj.bloom_uri == "urn:studium:bloom:understand"
    assert obj.edam_operation == "http://edamontology.org/operation_3214"


def test_scene_outline_optional_ontology_fields():
    from lesson_plan_schema import SceneOutline, SceneType
    scene = SceneOutline(
        id="sc-1",
        type=SceneType.reproduction,
        title="TP LC-MS",
        objective_refs=["obj-1"],
        abs_task_card_id="task_001",
        prov_derived_from=["doi:10.1073/pnas.1319030111"],
        dct_subject="Métabolomique",
    )
    assert scene.abs_task_card_id == "task_001"
    assert scene.prov_derived_from == ["doi:10.1073/pnas.1319030111"]


def test_lesson_plan_optional_provenance_fields():
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, BloomLevel, SceneType
    plan = LessonPlan(
        schema_version="1.0",
        id="plan-test-ont",
        title="Test ontologie",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Comprendre", bloom_level=BloomLevel.understand)
        ],
        scene_outlines=[
            SceneOutline(id="sc-1", type=SceneType.concept, title="Intro", objective_refs=["obj-1"])
        ],
        prov_entity_uri="urn:studium:plan:plan-test-ont",
        prov_derived_from=["doi:10.1073/pnas.1319030111"],
        prov_generated_by="urn:studium:activity:planner:run-xyz",
        dct_subject="Métabolomique",
        dct_language="fr",
        schema_educational_level="L3",
    )
    assert plan.prov_entity_uri == "urn:studium:plan:plan-test-ont"
    assert plan.dct_subject == "Métabolomique"
    assert plan.schema_educational_level == "L3"


def test_existing_fields_unchanged():
    """Régression : les champs M1 existants fonctionnent encore."""
    from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, BloomLevel, SceneType, PlanStatus
    plan = LessonPlan(
        schema_version="1.0",
        id="plan-regr",
        title="Régression M1",
        language="fr",
        target="L3",
        duration_minutes=45,
        learning_objectives=[
            LearningObjective(id="obj-1", description="Test", bloom_level=BloomLevel.apply)
        ],
        scene_outlines=[
            SceneOutline(id="sc-1", type=SceneType.quiz, title="Quiz", objective_refs=["obj-1"])
        ],
        status=PlanStatus.draft,
    )
    assert plan.status == PlanStatus.draft
    assert plan.prov_entity_uri is None  # nouveaux champs par défaut None


# ADR 014 Evidence schema tests
VALID_REF = {
    "perspicacite_doc_id": "doc-123",
    "title": "Test paper",
    "authors": ["Smith, J."],
    "excerpt": "A relevant excerpt",
    "relevance_score": 0.85,
    "prov_derived_from": "urn:perspicacite:doc:123",
}

VALID_ASSET = {
    "asset_type": "spectrum_viewer_svg",
    "payload_inline": "<svg></svg>",
    "prov_derived_from": "urn:abs:rocrate:abc",
}

VALID_METADATA = {
    "enricher_version": "1.0",
    "perspicacite_mode_used": "advanced",
    "timestamp": "2026-05-13T10:00:00Z",
    "degraded": False,
}


def test_evidence_accepts_full_payload():
    from lesson_plan_schema import (
        BibliographicRef,
        CaseStudy,
        ABSAsset,
        EnrichmentMetadata,
        Evidence,
    )
    ev = Evidence(
        bibliographic_refs=[BibliographicRef(**VALID_REF)],
        case_studies=[CaseStudy(title="Case A", summary="S", source_refs=["doc-123"])],
        abs_asset=ABSAsset(**VALID_ASSET),
        enrichment_metadata=EnrichmentMetadata(**VALID_METADATA),
    )
    assert ev.enrichment_metadata.perspicacite_mode_used == "advanced"


def test_evidence_requires_metadata():
    from lesson_plan_schema import Evidence
    with pytest.raises(ValidationError):
        Evidence()


def test_relevance_score_out_of_range_rejected():
    from lesson_plan_schema import BibliographicRef
    bad = dict(VALID_REF, relevance_score=1.5)
    with pytest.raises(ValidationError):
        BibliographicRef(**bad)


def test_unknown_asset_type_rejected():
    from lesson_plan_schema import ABSAsset
    bad = dict(VALID_ASSET, asset_type="unknown_type")
    with pytest.raises(ValidationError):
        ABSAsset(**bad)


def test_unknown_perspicacite_mode_rejected():
    from lesson_plan_schema import EnrichmentMetadata
    bad = dict(VALID_METADATA, perspicacite_mode_used="bogus")
    with pytest.raises(ValidationError):
        EnrichmentMetadata(**bad)


def test_scene_outline_accepts_evidence_and_override():
    from lesson_plan_schema import (
        SceneOutline,
        SceneType,
        Evidence,
        EnrichmentMetadata,
    )
    scene = SceneOutline(
        id="s1",
        type=SceneType.concept,
        title="Concept de base",
        evidence=Evidence(enrichment_metadata=EnrichmentMetadata(**VALID_METADATA)),
        evidence_override="force",
    )
    assert scene.evidence_override == "force"
    assert scene.evidence is not None


def test_lesson_plan_accepts_concepts():
    from lesson_plan_schema import LessonPlan, Concept
    plan = LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45,
        learning_objectives=[{"id": "obj-1", "description": "Understand X", "bloom_level": "understand"}],
        scene_outlines=[{"id": "s1", "type": "intro", "title": "I", "objective_refs": ["obj-1"]}],
        concepts=[Concept(id="obj-1", title="Understand X", description="Understand X", bloom_level_target="understand")],
    )
    assert plan.concepts[0].id == "obj-1" and plan.concepts[0].bloom_level_target == "understand"


def test_lesson_plan_concepts_defaults_empty():
    from lesson_plan_schema import LessonPlan
    plan = LessonPlan(
        id="p1", title="T", language="fr", target="L3", duration_minutes=45,
        learning_objectives=[{"id": "o", "description": "d", "bloom_level": "understand"}],
        scene_outlines=[{"id": "s1", "type": "intro", "title": "I", "objective_refs": []}],
    )
    assert plan.concepts == []


def test_corpus_ref_accepts_aligns_concept_ids():
    from lesson_plan_schema import CorpusRef
    r = CorpusRef(ref_id="cap1", ref_type="abs_capsule", abs_capsule_path="/x", aligns_concept_ids=["obj-1", "obj-2"])
    assert r.aligns_concept_ids == ["obj-1", "obj-2"]


def test_corpus_ref_aligns_concept_ids_defaults_none():
    from lesson_plan_schema import CorpusRef
    r = CorpusRef(ref_id="cap1", ref_type="abs_capsule")
    assert r.aligns_concept_ids is None
