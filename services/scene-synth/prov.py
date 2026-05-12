"""PROV-O JSON-LD minimal pour les bundles produits par scene-synth (A.6).

Le graphe est volontairement simple :
- une `prov:Entity` représentant la leçon générée
- une `prov:SoftwareAgent` représentant le service scene-synth
- une `prov:Entity` source (le plan)

Conformité : http://www.w3.org/ns/prov#
"""

from __future__ import annotations

from typing import Any


def build_prov_graph(
    scenes: list[Any], lesson_plan: dict, agent_info: dict
) -> dict:
    """Construit un graphe PROV-O JSON-LD pour la leçon assemblée.

    Parameters
    ----------
    scenes:
        Liste de scènes synthétisées (utilisée pour le compte/identifiants).
    lesson_plan:
        Plan d'entrée. Doit contenir au minimum ``lesson_id``.
    agent_info:
        Dict décrivant l'agent générateur. Clés attendues : ``agent`` (label
        humain) et ``version``.
    """
    lesson_id = lesson_plan["lesson_id"]
    plan_id = lesson_plan.get("plan_id", lesson_id)
    agent_version = agent_info["version"]
    agent_label = agent_info["agent"]

    return {
        "@context": {"prov": "http://www.w3.org/ns/prov#"},
        "@graph": [
            {
                "@id": f"urn:lesson:{lesson_id}",
                "@type": "prov:Entity",
                "prov:wasGeneratedBy": {
                    "@id": f"urn:agent:scene-synth:{agent_version}"
                },
                "prov:wasDerivedFrom": {"@id": f"urn:plan:{plan_id}"},
                "prov:atLocation": {
                    "@type": "prov:Collection",
                    "scene_count": len(scenes),
                },
            },
            {
                "@id": f"urn:agent:scene-synth:{agent_version}",
                "@type": "prov:SoftwareAgent",
                "prov:label": agent_label,
            },
            {
                "@id": f"urn:plan:{plan_id}",
                "@type": "prov:Entity",
            },
        ],
    }


__all__ = ["build_prov_graph"]
