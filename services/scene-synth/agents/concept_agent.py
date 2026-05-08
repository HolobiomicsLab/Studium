"""Agent de synthèse de la scène ``concept`` (A2).

Produit un ``ConceptScene`` Pydantic (cf. ``scene_synth_schemas``) à partir
d'une section de plan et d'un contexte.
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import ConceptScene

from .base import SceneAgent


class ConceptAgent(SceneAgent):
    scene_type = "concept"
    prompt_path = Path(__file__).parent.parent / "prompts" / "concept.j2"

    def _validate(self, raw: str) -> ConceptScene:
        return ConceptScene.model_validate(json.loads(raw))
