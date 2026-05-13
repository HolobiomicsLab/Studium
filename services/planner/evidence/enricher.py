"""EvidenceEnricher — enrichit les SceneOutline éligibles d'un LessonPlan."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Optional
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from planner_schemas import (
    LessonPlan,
    SceneOutline,
    SceneType,
    Evidence,
    EnrichmentMetadata,
    BibliographicRef,
)
from .perspicacite_mapper import select_mode, extract_refs


ELIGIBLE_TYPES = {
    SceneType.intro,
    SceneType.concept,
    SceneType.simulation,
    SceneType.reproduction,
}

ENRICHER_VERSION = "1.0"


def should_enrich(scene: SceneOutline) -> bool:
    """Décide si une scène doit être enrichie (heuristique + override auteur)."""
    if scene.evidence_override == "force":
        return True
    if scene.evidence_override == "skip":
        return False
    if scene.type not in ELIGIBLE_TYPES:
        return False
    return True


class EvidenceEnricher:
    """Orchestrateur Perspicacité + ABS asset → SceneOutline.evidence."""

    def __init__(self, perspicacite_client: Any, abs_reader: Any) -> None:
        self.perspicacite = perspicacite_client
        self.abs_reader = abs_reader

    def enrich(self, plan: LessonPlan) -> LessonPlan:
        """Enrichit chaque scène éligible et retourne un plan modifié (in-place)."""
        for scene in plan.scene_outlines:
            if not should_enrich(scene):
                continue
            self._enrich_scene(scene)
        return plan

    def _enrich_scene(self, scene: SceneOutline) -> None:
        mode = select_mode(scene.type)
        degraded = False
        bibliographic_refs: Optional[list[BibliographicRef]] = None
        try:
            response = self.perspicacite.search(
                query=scene.title, mode=mode, max_results=5
            )
            bibliographic_refs = extract_refs(response) or None
            if not bibliographic_refs:
                degraded = True
        except Exception:
            degraded = True

        scene.evidence = Evidence(
            bibliographic_refs=bibliographic_refs,
            enrichment_metadata=EnrichmentMetadata(
                enricher_version=ENRICHER_VERSION,
                perspicacite_mode_used=mode,
                timestamp=datetime.now(timezone.utc).isoformat(),
                degraded=degraded,
            ),
        )
