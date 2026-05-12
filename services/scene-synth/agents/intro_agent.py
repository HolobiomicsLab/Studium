"""Agent de synthèse de la scène ``intro`` (A2).

Produit un ``IntroScene`` Pydantic (cf. ``scene_synth_schemas``) à partir
d'une section de plan et d'un contexte.
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import IntroScene

from .base import SceneAgent


class IntroAgent(SceneAgent):
    scene_type = "intro"
    prompt_path = Path(__file__).parent.parent / "prompts" / "intro.j2"

    def _validate(self, raw: str) -> IntroScene:
        return IntroScene.model_validate(json.loads(raw))
