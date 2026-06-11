"""Import an ASB (AgenticScienceBuilder) capsule directory as an LWG reproduction
subgraph (Mode B, ingest-only). Reuses ASB's emitted characterization — Suter 5-axis +
task_openness from workflow_score.json, reproducibility_tier from each task_card.json —
never re-derives. Returns plain LWG node/edge dicts. Best-effort: a missing or garbled
capsule yields ([], []) rather than raising."""
from __future__ import annotations
import glob
import json
import os
from typing import Any

_SCAFFOLD_BY_TIER = {
    "certified": "light",
    "type-checked": "light",
    "bypassed": "moderate",
    "manual-only": "heavy",
    "experimental": "exploratory",
}
_DEFAULT_SCAFFOLD = "moderate"

_SUTER_AXES = (
    "coupling", "composition_modularity", "abstraction_level",
    "orchestration_planning", "data_transport",
)
_SUTER_FALLBACK = {
    "coupling": "ad_hoc", "composition_modularity": "flat",
    "abstraction_level": "implicit", "orchestration_planning": "static",
    "data_transport": "file",
}


def tier_to_scaffolding(tier: str) -> str:
    return _SCAFFOLD_BY_TIER.get(tier, _DEFAULT_SCAFFOLD)


def _read_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def import_reproduction_subgraph(capsule_dir: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    score_path = os.path.join(capsule_dir, "workflow_score.json")
    if not os.path.isfile(score_path):
        return [], []
    try:
        score = _read_json(score_path)
    except (ValueError, OSError):
        return [], []
    if not isinstance(score, dict):
        return [], []

    workflow_id = score.get("workflow_id") or "workflow"
    openness = (score.get("structural") or {}).get("task_openness") or "closed"
    wc = score.get("workflow_characteristics") or {}
    suter = {axis: wc.get(axis) or _SUTER_FALLBACK[axis] for axis in _SUTER_AXES}

    concept_id = f"concept:abs:{workflow_id}"
    nodes: list[dict[str, Any]] = [{
        "id": concept_id,
        "node_kind": "concept",
        "title": f"Reproduction workflow: {workflow_id}",
        "bloom_level": "apply",
    }]
    edges: list[dict[str, Any]] = []

    card_paths = sorted(glob.glob(os.path.join(capsule_dir, "capsules", "*", "task_card.json")))
    for cp in card_paths:
        try:
            card = _read_json(cp)
        except (ValueError, OSError):
            continue
        task_id = card.get("task_id")
        if not task_id:
            continue
        node_id = f"task:abs:{task_id}"
        tier = card.get("reproducibility_tier") or "type-checked"
        nodes.append({
            "id": node_id,
            "node_kind": "task",
            "title": card.get("title") or task_id,
            "scene_type": "reproduction",
            "characterization": {
                "suter": dict(suter),
                "reproducibility_tier": tier,
                "task_openness": openness,
                "scaffolding_level": tier_to_scaffolding(tier),
            },
        })
        edges.append({
            "id": f"partof:abs:{task_id}",
            "relation": "part_of",
            "source": node_id,
            "target": concept_id,
        })
        for upstream in (card.get("input_from") or []):
            edges.append({
                "id": f"prereq:abs:{task_id}:{upstream}",
                "relation": "prerequisite_for",
                "source": node_id,
                "target": f"task:abs:{upstream}",
            })
    return nodes, edges
