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

    # Pass 1: collect valid cards (a card needs a task_id).
    cards: list[dict[str, Any]] = []
    for cp in sorted(glob.glob(os.path.join(capsule_dir, "capsules", "*", "task_card.json"))):
        try:
            card = _read_json(cp)
        except (ValueError, OSError):
            continue
        if isinstance(card, dict) and card.get("task_id"):
            cards.append(card)

    concept_id = f"concept:abs:{workflow_id}"
    known_ids = {f"task:abs:{c['task_id']}" for c in cards}
    nodes: list[dict[str, Any]] = [{
        "id": concept_id,
        "node_kind": "concept",
        "title": f"Reproduction workflow: {workflow_id}",
        "bloom_level": "apply",
    }]
    edges: list[dict[str, Any]] = []

    # Pass 2: emit task nodes + part_of, then prerequisite_for from normalized input_from.
    for card in cards:
        task_id = card["task_id"]
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
        raw_upstream = card.get("input_from")
        upstreams = [raw_upstream] if isinstance(raw_upstream, str) else (raw_upstream or [])
        for upstream in upstreams:
            target = f"task:abs:{upstream}"
            if target not in known_ids:
                continue  # drop dangling prerequisite (upstream has no card)
            edges.append({
                "id": f"prereq:abs:{task_id}:{upstream}",
                "relation": "prerequisite_for",
                "source": node_id,
                "target": target,
            })
    return nodes, edges
