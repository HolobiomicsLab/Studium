"""Mapping Perspicacité mode × scene_type + extraction refs structurées."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../packages/lesson-plan-schema/python"))

from lesson_plan_schema import SceneType, BibliographicRef


_MODE_BY_TYPE = {
    SceneType.intro: "advanced",
    SceneType.concept: "advanced",
    SceneType.simulation: "profound",
    SceneType.reproduction: "agentic",
}


def select_mode(scene_type: SceneType) -> str:
    """Sélectionne le mode RAG Perspicacité pour un scene_type.

    Mapping fixe ADR 014 :
    - intro/concept → advanced (résumé + 3-5 refs)
    - simulation → profound (deep retrieval cas spécifique)
    - reproduction → agentic (chaînage protocole)
    - autre → advanced (fallback conservateur)
    """
    return _MODE_BY_TYPE.get(scene_type, "advanced")


def extract_refs(perspicacite_response: dict) -> list[BibliographicRef]:
    """Convertit une réponse Perspicacité MCP en list[BibliographicRef] validée.

    Inputs offline / status≠ok → retourne liste vide (degraded path géré upstream).
    Excerpts > 500 chars sont tronqués à 500.
    """
    if perspicacite_response.get("status") != "ok":
        return []
    refs: list[BibliographicRef] = []
    for d in perspicacite_response.get("docs", []):
        excerpt = d.get("excerpt", "")
        if len(excerpt) > 500:
            excerpt = excerpt[:500]
        refs.append(
            BibliographicRef(
                perspicacite_doc_id=d["id"],
                doi=d.get("doi"),
                title=d["title"],
                authors=d["authors"],
                year=d.get("year"),
                excerpt=excerpt,
                relevance_score=d["relevance_score"],
                prov_derived_from=f"urn:perspicacite:doc:{d['id']}",
            )
        )
    return refs
