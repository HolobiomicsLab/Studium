"""Assemble + write ASTRA artifacts (astra.yaml + universes/*.yaml). Studium-local
emission following astra-spec analysis.yaml / universe.yaml; the version and the id
grammar come from the vendored contract (provenance/astra_contract.py)."""
from __future__ import annotations
import os
from typing import Any

from provenance.astra_contract import ASTRA_SCHEMA_VERSION, slugify_id

# Non-id field carrying the raw Studium edge id an entry was keyed by before
# slugification. approval.py joins a Claim to its ASTRA entry through the edge id
# embedded in `astra_insight_ref`, so the raw value must survive the coercion.
SOURCE_ID_FIELD = "source_edge_id"


def _keyed_by_astra_id(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Key `entries` (each carrying an "id") by a grammar-valid ASTRA id, keeping the
    raw id under SOURCE_ID_FIELD. Returns the id -> body map ASTRA containers use."""
    taken: set[str] = set()
    out: dict[str, dict[str, Any]] = {}
    for entry in entries:
        body = {k: v for k, v in entry.items() if k != "id"}
        body[SOURCE_ID_FIELD] = entry["id"]
        out[slugify_id(entry["id"], taken)] = body
    return out


def emit_astra(
    *,
    analysis_id: str,
    name: str,
    decisions: list[dict[str, Any]],
    prior_insights: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build an ASTRA Analysis dict. decisions/prior_insights/findings are keyed by
    grammar-valid ids (the raw id is kept under SOURCE_ID_FIELD); analysis_id is
    coerced the same way. Returns the Analysis ready for write_astra_yaml."""
    return {
        "id": slugify_id(analysis_id),
        "version": ASTRA_SCHEMA_VERSION,
        "name": name,
        "decisions": _keyed_by_astra_id(decisions),
        "prior_insights": _keyed_by_astra_id(prior_insights),
        "findings": _keyed_by_astra_id(findings),
        "outputs": outputs,
    }


def baseline_universe(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """The baseline Universe: each decision's default option (ASTRA flat map shape)."""
    return {
        "id": "baseline",
        "description": "Default option per decision across the analysis.",
        "decisions": {slugify_id(d["id"]): d["default"] for d in decisions},
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
