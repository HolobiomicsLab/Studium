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
    """Build an ASTRA document in the ASB shape: version/name/inputs/outputs at the
    root (no root id) and the course as ONE sub-analysis under `analyses`, keyed and
    id'd by the slugified analysis_id. Container entries are keyed by grammar-valid
    ids with the raw id kept under SOURCE_ID_FIELD. Root outputs re-export each
    sub-analysis output via `from`, as ASB emitters do."""
    slug = slugify_id(analysis_id)
    return {
        "version": ASTRA_SCHEMA_VERSION,
        "name": name,
        "description": "Studium author-time course build; the sub-analysis carries "
                       "the build's decisions and findings.",
        "inputs": [{"id": "course_manifest", "type": "data",
                    "description": f"Course manifest and corpus references for {name}."}],
        "outputs": [{"id": f"{slug}_result", "from": f"{slug}.{o['id']}"} for o in outputs],
        "analyses": {slug: {
            "id": slug,
            "name": name,
            "decisions": _keyed_by_astra_id(decisions),
            "prior_insights": _keyed_by_astra_id(prior_insights),
            "findings": _keyed_by_astra_id(findings),
            "outputs": outputs,
        }},
    }


def analysis_body(doc: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """(slug, sub-analysis body) of an ASTRA document. A pre-nesting flat document
    (no `analyses` container) is its own body, so old artifacts keep resolving."""
    analyses = doc.get("analyses")
    if not analyses:
        return doc.get("id", ""), doc
    slug = next(iter(analyses))
    return slug, analyses[slug]


def baseline_universe(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """The baseline Universe selection: each decision's default option, flat.
    This is the in-API shape; nest_universe wraps it for the written artifact."""
    return {
        "id": "baseline",
        "description": "Default option per decision across the analysis.",
        "decisions": {slugify_id(d["id"]): d["default"] for d in decisions},
    }


def nest_universe(universe: dict[str, Any], analysis_slug: str) -> dict[str, Any]:
    """Wrap a flat Universe selection into the ASB universe.yaml shape: the option
    map sits under `analyses.<slug>.decisions` instead of at the root."""
    return {
        "id": universe["id"],
        "description": universe["description"],
        "analyses": {analysis_slug: {"decisions": universe["decisions"]}},
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
