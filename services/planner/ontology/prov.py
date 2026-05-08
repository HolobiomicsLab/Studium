"""Construction du graphe Prov-O JSON-LD à partir d'un LessonPlan + audit + critique."""
from __future__ import annotations
from typing import Any, TYPE_CHECKING

from ontology import CONTEXT

if TYPE_CHECKING:
    from lesson_plan_schema import LessonPlan
    from planner_schemas import CritiqueResult


def build_prov_graph(
    plan: "LessonPlan",
    manifest: dict[str, Any],
    planner_audit: dict[str, Any],
    critique: "CritiqueResult",
) -> dict[str, Any]:
    """Retourne un graphe JSON-LD Prov-O croisant les ontologies du design M2."""
    nodes: list[dict[str, Any]] = []

    # — Entité plan
    plan_uri = plan.prov_entity_uri or f"urn:studium:plan:{plan.id}"
    plan_node: dict[str, Any] = {
        "@id": plan_uri,
        "@type": ["prov:Entity", "schema:LearningResource"],
    }
    if plan.prov_derived_from:
        plan_node["prov:wasDerivedFrom"] = [{"@id": u} for u in plan.prov_derived_from]
    if plan.prov_generated_by:
        plan_node["prov:wasGeneratedBy"] = {"@id": plan.prov_generated_by}
    if plan.dct_subject:
        plan_node["dct:subject"] = plan.dct_subject
    if plan.dct_language:
        plan_node["dct:language"] = plan.dct_language
    if plan.schema_educational_level:
        plan_node["schema:educationalLevel"] = plan.schema_educational_level
    nodes.append(plan_node)

    # — Activité planner
    planner_activity_uri = plan.prov_generated_by or f"urn:studium:activity:planner:unknown"
    planner_node: dict[str, Any] = {
        "@id": planner_activity_uri,
        "@type": "prov:Activity",
        "schema:provider": f"{planner_audit.get('provider', 'unknown')}/{planner_audit.get('alias', '')}",
    }
    if plan.prov_derived_from:
        planner_node["prov:used"] = [{"@id": u} for u in plan.prov_derived_from]
    nodes.append(planner_node)

    # — Activité critic
    critic_uri = critique.prov_activity_uri
    critic_node: dict[str, Any] = {
        "@id": critic_uri,
        "@type": "prov:Activity",
        "prov:used": {"@id": plan_uri},
        "skos:note": f"bloom_consistency: {critique.bloom_consistency}",
        "schema:value": critique.score,
    }
    nodes.append(critic_node)

    # — Entités CorpusRef
    for ref in plan.corpus_refs:
        ref_uri = ref.prov_entity_uri or (f"doi:{ref.doi}" if ref.doi else f"urn:studium:ref:{ref.ref_id}")
        ref_node: dict[str, Any] = {
            "@id": ref_uri,
            "@type": ["prov:Entity", "schema:ScholarlyArticle"],
        }
        if ref.dct_source:
            ref_node["dct:source"] = ref.dct_source
        if ref.skos_subject:
            ref_node["skos:subject"] = ref.skos_subject
        if ref.abs_capsule_path:
            ref_node["repme:ScientificWorkflow"] = ref.abs_capsule_path
        nodes.append(ref_node)

    # — Objectifs d'apprentissage
    for obj in plan.learning_objectives:
        obj_uri = f"urn:studium:objective:{plan.id}:{obj.id}"
        obj_node: dict[str, Any] = {"@id": obj_uri, "@type": "prov:Entity"}
        if obj.bloom_uri:
            obj_node["schema:educationalAlignment"] = {"@type": "schema:AlignmentObject", "schema:alignmentType": "teaches", "schema:targetName": obj.description}
        if obj.skos_concept_uri:
            obj_node["skos:broader"] = {"@id": obj.skos_concept_uri}
        if obj.skos_related:
            obj_node["skos:related"] = [{"@id": u} for u in obj.skos_related]
        if obj.esco_skill_uri:
            obj_node["esco:skill"] = {"@id": obj.esco_skill_uri}
        if obj.edam_operation:
            obj_node["edam:operation"] = {"@id": obj.edam_operation}
        if obj.edam_topics:
            obj_node["edam:topic"] = [{"@id": t} for t in obj.edam_topics]
        nodes.append(obj_node)

    # — Scènes
    for scene in plan.scene_outlines:
        scene_uri = f"urn:studium:scene:{plan.id}:{scene.id}"
        scene_node: dict[str, Any] = {"@id": scene_uri, "@type": "schema:LearningResource"}
        if scene.prov_derived_from:
            scene_node["prov:wasDerivedFrom"] = [{"@id": u} for u in scene.prov_derived_from]
        if scene.dct_subject:
            scene_node["dct:subject"] = scene.dct_subject
        if scene.abs_task_card_id:
            scene_node["repme:ScientificVariable"] = scene.abs_task_card_id
        if scene.skos_concept_uris:
            scene_node["skos:related"] = [{"@id": u} for u in scene.skos_concept_uris]
        nodes.append(scene_node)

    return {"@context": CONTEXT, "@graph": nodes}
