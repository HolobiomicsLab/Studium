"""Sérialisation JSON-LD optionnelle. rdflib requis uniquement pour serialize_turtle."""
from __future__ import annotations
import json
from typing import Any


def serialize_jsonld(graph: dict[str, Any]) -> str:
    """Retourne le graphe JSON-LD comme string indentée. Aucune dépendance externe."""
    return json.dumps(graph, ensure_ascii=False, indent=2)


def serialize_turtle(graph: dict[str, Any]) -> str:
    """Conversion Turtle via rdflib. Lève ImportError si rdflib absent."""
    try:
        from rdflib import Graph
    except ImportError as exc:
        raise ImportError(
            "rdflib est requis pour serialize_turtle. "
            "Installer avec: pip install studium-planner[rdf]"
        ) from exc
    g = Graph()
    g.parse(data=serialize_jsonld(graph), format="json-ld")
    return g.serialize(format="turtle")
