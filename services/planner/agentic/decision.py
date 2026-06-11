"""ASTRA-shaped record builders (Studium-local emission model, version-pinned —
the ASB precedent: re-declare the shape rather than depend on astra-spec).
Matches astra-spec analysis.yaml / insight.yaml v0.0.10."""
from __future__ import annotations
from typing import Any, Optional

ASTRA_SCHEMA_VERSION = "0.0.10"


def make_decision(
    *,
    decision_id: str,
    label: str,
    rationale: str,
    options: list[dict[str, Any]],
    default: str,
    when: Optional[list[str]] = None,
) -> dict[str, Any]:
    """An ASTRA Decision: a methodological/pedagogical choice point.
    options: list of {id, label, description?, excluded?, excluded_reason?}."""
    opt_map: dict[str, dict[str, Any]] = {}
    for o in options:
        oid = o["id"]
        entry = {k: v for k, v in o.items() if k != "id"}
        opt_map[oid] = entry
    d: dict[str, Any] = {"id": decision_id, "label": label, "rationale": rationale,
                         "default": default, "options": opt_map}
    if when:
        d["when"] = when
    return d


def make_evidence(
    *,
    doi: Optional[str] = None,
    artifact: Optional[str] = None,
    quote: Optional[str] = None,
    page: Optional[int] = None,
    confidence: Optional[float] = None,
    decision_context: Optional[list[str]] = None,
) -> dict[str, Any]:
    """An ASTRA Evidence: exactly one of doi/artifact (W3C-aligned selectors)."""
    if (doi is None) == (artifact is None):
        raise ValueError("Evidence requires exactly one of doi/artifact")
    ev: dict[str, Any] = {}
    if doi:
        ev["doi"] = doi
    else:
        ev["artifact"] = artifact
    if quote:
        ev["quote"] = {"exact": quote}
    if page is not None:
        ev["location"] = {"page": page}
    if confidence is not None:
        ev["confidence"] = confidence
    if decision_context:
        ev["decision_context"] = decision_context
    return ev


def make_insight(
    *,
    insight_id: str,
    claim: str,
    created_at: str,
    evidence: list[dict[str, Any]],
    derived: bool = False,
    indicium_claim_ref: Optional[str] = None,
) -> dict[str, Any]:
    """An ASTRA Insight: evidence-first claim (used for prior_insights and findings)."""
    if not evidence:
        raise ValueError("Insight requires at least one evidence")
    i: dict[str, Any] = {"id": insight_id, "claim": claim, "created_at": created_at,
                         "evidence": evidence, "derived": derived}
    if indicium_claim_ref:
        i["indicium_claim_ref"] = indicium_claim_ref
    return i
