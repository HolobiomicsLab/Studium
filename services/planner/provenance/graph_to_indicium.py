"""Serialize an LWG (plain dict) to an indicium JSON-LD claim graph. Each edge -> a
Bucur 5-slot Claim; each edge.evidence[] -> a SEPIO Evidence node linked via
supports_claim. Follows indicium.yaml shape; emits plain dicts (no indicium import)."""
from __future__ import annotations
from typing import Any

from .education_adapter import route_qualifier

_CONTEXT = {
    "asb": "https://asb.holobiomics.org/ns/asb#",
    "prov": "http://www.w3.org/ns/prov#",
    "sepio": "http://purl.obolibrary.org/obo/SEPIO_",
    "eco": "http://purl.obolibrary.org/obo/ECO_",
    "dct": "http://purl.org/dc/terms/",
    "bloom": "urn:studium:bloom:",
}

# free-text predicate phrase per relation (the indicium `relation` slot)
_RELATION_PHRASE = {
    "prerequisite_for": "requires prior mastery of",
    "part_of": "is part of",
    "decomposes_into": "decomposes into",
    "assesses": "assesses mastery of",
    "aligns_with": "aligns with",
    "demonstrates_mastery_of": "demonstrates mastery of",
}


def _claim_for_edge(edge: dict[str, Any], course_id: str, asserted_by: str) -> dict[str, Any]:
    bucur, domain_q = route_qualifier(edge["relation"])
    claim: dict[str, Any] = {
        "@type": "asb:Claim",
        "id": f"urn:studium:edge:{edge['id']}",
        "context": f"course:{course_id}",
        "subject": edge["source"],
        "relation": _RELATION_PHRASE.get(edge["relation"], edge["relation"]),
        "object": edge["target"],
        "claim_type": "implicit",
        "claim_status": "draft",
        "asserted_by": asserted_by,
        "domain_qualifier": domain_q,
    }
    if bucur:
        claim["qualifier"] = bucur
    if edge.get("astra_insight_ref"):
        claim["astra_insight_ref"] = edge["astra_insight_ref"]
    return claim


def _evidence_nodes(edge: dict[str, Any], claim_id: str) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for ev in edge.get("evidence", []) or []:
        node: dict[str, Any] = {
            "@type": "sepio:0000002",
            "supports_claim": claim_id,
            "evidence_type": "citation" if ev.get("doi") else "inference",
            "source_type": "text",
        }
        if ev.get("doi"):
            node["doi"] = ev["doi"]
        if ev.get("artifact"):
            node["of_source"] = ev["artifact"]
        if ev.get("quote"):
            node["quote"] = ev["quote"]
        if ev.get("page") is not None:
            node["quote_location"] = f"page={ev['page']}"
        if ev.get("confidence") is not None:
            node["confidence"] = ev["confidence"]
        if ev.get("decision_context"):
            node["decision_context"] = ev["decision_context"]
        nodes.append(node)
    return nodes


def graph_to_claims(lwg: dict[str, Any], *, asserted_by: str) -> dict[str, Any]:
    """Return a JSON-LD doc {@context, @graph:[Claim/Evidence ...]}."""
    course_id = lwg["course_id"]
    graph: list[dict[str, Any]] = []
    for edge in lwg.get("edges", []):
        claim = _claim_for_edge(edge, course_id, asserted_by)
        graph.append(claim)
        graph.extend(_evidence_nodes(edge, claim["id"]))
    return {"@context": dict(_CONTEXT), "@graph": graph}
