"""Assemble + write ASTRA artifacts (astra.yaml + universes/*.yaml). Studium-local
emission following astra-spec analysis.yaml / universe.yaml v0.0.10."""
from __future__ import annotations
import os
from typing import Any

from agentic.decision import ASTRA_SCHEMA_VERSION


def emit_astra(
    *,
    analysis_id: str,
    name: str,
    decisions: list[dict[str, Any]],
    prior_insights: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build an ASTRA Analysis dict (decisions/prior_insights/findings keyed by id)."""
    return {
        "id": analysis_id,
        "version": ASTRA_SCHEMA_VERSION,
        "name": name,
        "decisions": {d["id"]: {k: v for k, v in d.items() if k != "id"} for d in decisions},
        "prior_insights": {i["id"]: {k: v for k, v in i.items() if k != "id"} for i in prior_insights},
        "findings": {f["id"]: {k: v for k, v in f.items() if k != "id"} for f in findings},
        "outputs": outputs,
    }


def baseline_universe(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """The baseline Universe: each decision's default option."""
    return {
        "id": "baseline",
        "description": "Default option per decision across the analysis.",
        "decisions": [{"decision_id": d["id"], "option_id": d["default"]} for d in decisions],
    }


def write_astra_yaml(analysis: dict[str, Any], out_dir: str) -> None:
    import yaml
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "astra.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(analysis, f, sort_keys=False, allow_unicode=True)


def write_universe_yaml(universe: dict[str, Any], out_dir: str) -> None:
    import yaml
    udir = os.path.join(out_dir, "universes")
    os.makedirs(udir, exist_ok=True)
    with open(os.path.join(udir, f"{universe['id']}.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(universe, f, sort_keys=False, allow_unicode=True)
