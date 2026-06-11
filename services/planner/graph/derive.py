"""Derive the deterministic backbone of a Learning Workflow Graph from a LessonPlan:
concept nodes from learning_objectives, task nodes from scene_outlines, and `assesses`
edges from scene.objective_refs. No LLM. Returns plain dicts (LWG node/edge shape)."""
from __future__ import annotations
from typing import Any


def _enum_value(v: Any) -> Any:
    return v.value if hasattr(v, "value") else v


def derive_base_graph(plan: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes: list[dict[str, Any]] = []
    objectives = {o.id: o for o in plan.learning_objectives}

    for obj in plan.learning_objectives:
        nodes.append({
            "id": f"concept:{obj.id}",
            "node_kind": "concept",
            "title": obj.description,
            "bloom_level": _enum_value(obj.bloom_level),
        })
    for scene in plan.scene_outlines:
        nodes.append({
            "id": f"task:{scene.id}",
            "node_kind": "task",
            "title": scene.title,
            "scene_type": _enum_value(scene.type),
            "objective_refs": list(scene.objective_refs or []),
        })

    edges: list[dict[str, Any]] = []
    for scene in plan.scene_outlines:
        for oref in (scene.objective_refs or []):
            obj = objectives.get(oref)
            if obj is None:
                continue
            edges.append({
                "id": f"assesses:{scene.id}:{oref}",
                "relation": "assesses",
                "source": f"task:{scene.id}",
                "target": f"concept:{oref}",
                "objective_id": oref,
                "bloom_level": _enum_value(obj.bloom_level),
            })
    return nodes, edges
