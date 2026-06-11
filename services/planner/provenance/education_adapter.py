"""Education DomainAdapter for indicium (structural — satisfies indicium-adapters'
DomainAdapter Protocol without importing it). Bundled in Studium per v1 decision;
sibling-repo extraction is a follow-up. Routes ed-relations to the closed Bucur
qualifier (when an analog exists) + the open domain_qualifier."""
from __future__ import annotations
from typing import Any, Optional

# ed-relation -> (Bucur core term or None, domain_qualifier term)
_RELATION_MAP: dict[str, tuple[Optional[str], str]] = {
    "prerequisite_for": ("requires", "prerequisite_for"),
    "part_of": ("is_part_of", "part_of"),
    "decomposes_into": (None, "decomposes_into"),
    "assesses": (None, "assesses"),
    "aligns_with": (None, "aligns_with"),
    "demonstrates_mastery_of": (None, "demonstrates_mastery_of"),
}

_BLOOM_BASE = "urn:studium:bloom:"


def route_qualifier(relation: str) -> tuple[Optional[str], str]:
    """Return (bucur_qualifier_or_None, domain_qualifier)."""
    return _RELATION_MAP.get(relation, (None, relation))


class EducationAdapter:
    domain_id = "education"
    qualifiers = frozenset(_RELATION_MAP.keys())
    ontology_prefixes = {
        "BLOOM": _BLOOM_BASE,
        "ESCO": "http://data.europa.eu/esco/model#",
        "EDAM": "http://edamontology.org/",
        "SCHEMA": "https://schema.org/",
        "LOM": "http://ltsc.ieee.org/xsd/LOM/",
    }

    def extraction_context(self) -> str:
        return (
            "Domain: education. Extra qualifiers: "
            + ", ".join(sorted(self.qualifiers))
            + ". Subjects/objects are concept or task node IDs; objects may carry a bloom_level."
        )

    def enrich_claim(self, claim: dict[str, Any]) -> dict[str, Any]:
        """Pure: returns a new dict; never mutates input. Adds ontology_terms (e.g. bloom URI)."""
        out = dict(claim)
        terms: dict[str, str] = dict(out.get("ontology_terms") or {})
        bloom = out.get("bloom_level")
        if bloom:
            terms["bloom"] = f"{_BLOOM_BASE}{bloom}"
        if terms:
            out["ontology_terms"] = terms
        return out
