"""Vendored minimal indicium LinkML node-shape (enums + permitted slot sets).

indicium is intentionally NOT a dependency of prototype-build (the LWG emitter
emits plain indicium-shaped dicts without importing indicium; see
graph_to_indicium.py). To make conformance testable OFFLINE — without pulling
linkml/indicium into this .venv — we vendor the *minimal* shape we need: the
closed enum value-sets and the permitted Claim/Evidence slot names.

SOURCE OF TRUTH (copy these verbatim; keep this file in lock-step):
  /Users/holobiomicslab/git/indicium/src/indicium/schema/indicium.yaml
    - enums           : indicium.yaml:26-188
    - Claim slots     : indicium.yaml:490-509
    - Evidence slots  : indicium.yaml:510-516
    - domain_qualifier pattern   : indicium.yaml:204-215 (^[a-z][a-z0-9_]*$)
    - decision_context pattern   : indicium.yaml:333-338 (dotted id.option)
  Generated Pydantic mirror (extra="forbid"): src/indicium/generated/model.py:36-46

The gated round-trip test (test_provenance_indicium_roundtrip*.py) validates
against the REAL model when indicium is pip-installed; this vendored copy is the
offline fallback so conformance never silently goes untested.
"""
from __future__ import annotations

import re

# --- Closed enums (indicium.yaml:26-188) ---------------------------------
CLAIM_TYPE = frozenset({"explicit", "implicit"})
CLAIM_STATUS = frozenset({"draft", "verified", "published", "retracted", "superseded"})
EVIDENCE_TYPE = frozenset({"data", "citation", "knowledge", "inference", "speculation"})
SOURCE_TYPE = frozenset({"text", "figure", "table", "image", "code", "data"})
SUPER_PATTERN_QUALIFIER = frozenset({
    "causes", "prevents", "inhibits", "activates", "increases", "decreases",
    "correlates_with", "is_associated_with", "predicts", "interacts_with",
    "produces", "requires", "enables", "treats", "enhances", "reduces",
    "has_property", "is_part_of", "is_a", "consistent_with",
})
WORKFLOW_COUPLING = frozenset({"tight", "loose", "ad_hoc", "unknown"})
SOURCE_TASK_KIND = frozenset({
    "reproduction", "analysis", "component_reconstruction", "extension",
})
ECO_CODE_ASB_SUBSET = frozenset({
    "textual_quotation", "computational_evidence", "expert_curation",
    "inference_from_background_knowledge", "author_statement",
    "experimental_evidence", "combinatorial_evidence",
    "traceable_author_statement",
})

# --- Permitted slot names (indicium.yaml Claim:490-509 / Evidence:510-516) ---
# `@type`/`@id`/`@context` are JSON-LD framing keys, NOT LinkML slots: the real
# Pydantic model (extra="forbid") rejects `@type`. The conformance check strips
# `@type` before measuring slots (see _strip_jsonld_framing), so it is allowed
# only as a framing key, not counted as a slot.
JSONLD_FRAMING_KEYS = frozenset({"@type", "@id", "@context"})

CLAIM_SLOTS = frozenset({
    "id", "context", "subject", "qualifier", "super_pattern", "domain_qualifier",
    "relation", "predicate", "object", "claim_type", "source_excerpt",
    "claim_status", "asserted_by", "astra_insight_ref", "superseded_by",
    "source_task_kind",
})
EVIDENCE_SLOTS = frozenset({
    "evidence_type", "eco_code", "source_type", "quote", "quote_exact",
    "quote_location", "confidence", "of_source", "for_claim", "supports_claim",
    "of_figure", "of_script", "of_dataset", "text_selector", "fragment_selector",
    "decision_context", "asserted_by", "workflow_coupling",
})
# Source is an inlined object under Evidence.of_source (indicium.yaml:517-520).
SOURCE_SLOTS = frozenset({
    "identifier", "doi", "title", "authors", "license_id", "paragraph_id",
    "xpath_pointer",
})

# Enum-valued slots -> permitted value-set, per class.
CLAIM_ENUM_SLOTS = {
    "claim_type": CLAIM_TYPE,
    "claim_status": CLAIM_STATUS,
    "qualifier": SUPER_PATTERN_QUALIFIER,
    "super_pattern": SUPER_PATTERN_QUALIFIER,
    "source_task_kind": SOURCE_TASK_KIND,
}
EVIDENCE_ENUM_SLOTS = {
    "evidence_type": EVIDENCE_TYPE,
    "source_type": SOURCE_TYPE,
    "eco_code": ECO_CODE_ASB_SUBSET,
    "workflow_coupling": WORKFLOW_COUPLING,
}

DOMAIN_QUALIFIER_RE = re.compile(r"^[a-z][a-z0-9_]*$")
DECISION_CONTEXT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$")


def _strip_jsonld_framing(node: dict) -> dict:
    """Drop JSON-LD framing keys (@type/@context) so the remaining keys can be
    measured as LinkML slots. `@id` maps to the `id` slot (context.jsonld:26),
    so it is left in place only if `id` is absent."""
    out = dict(node)
    out.pop("@type", None)
    out.pop("@context", None)
    return out


def assert_claim_conformant(node: dict) -> None:
    """Raise AssertionError if `node` is not a conformant indicium Claim node."""
    body = _strip_jsonld_framing(node)
    extra = set(body) - CLAIM_SLOTS
    assert not extra, f"Claim has illegal slot(s): {sorted(extra)}"
    for slot, allowed in CLAIM_ENUM_SLOTS.items():
        if slot in body:
            assert body[slot] in allowed, f"Claim.{slot}={body[slot]!r} not in {sorted(allowed)}"
    dq = body.get("domain_qualifier")
    if dq is not None:
        assert DOMAIN_QUALIFIER_RE.match(dq), f"domain_qualifier {dq!r} fails pattern"
    # QualifierPresenceShape: at least one of {qualifier, domain_qualifier}.
    assert body.get("qualifier") or body.get("domain_qualifier"), (
        "Claim must carry at least one of {qualifier, domain_qualifier}"
    )


def assert_evidence_conformant(node: dict) -> None:
    """Raise AssertionError if `node` is not a conformant indicium Evidence node."""
    body = _strip_jsonld_framing(node)
    extra = set(body) - EVIDENCE_SLOTS
    assert not extra, f"Evidence has illegal slot(s): {sorted(extra)}"
    for slot, allowed in EVIDENCE_ENUM_SLOTS.items():
        if slot in body:
            assert body[slot] in allowed, f"Evidence.{slot}={body[slot]!r} not in {sorted(allowed)}"
    src = body.get("of_source")
    if src is not None:
        assert isinstance(src, dict), f"of_source must be an inlined Source object, got {type(src).__name__}"
        src_extra = set(src) - SOURCE_SLOTS
        assert not src_extra, f"of_source (Source) has illegal slot(s): {sorted(src_extra)}"
        assert "identifier" in src, "of_source (Source) requires `identifier`"
    dc = body.get("decision_context")
    if dc is not None:
        assert isinstance(dc, list), "decision_context must be a list"
        for tag in dc:
            assert DECISION_CONTEXT_RE.match(tag), f"decision_context {tag!r} fails dotted pattern"
