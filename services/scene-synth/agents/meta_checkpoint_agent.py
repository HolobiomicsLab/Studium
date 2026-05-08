"""Agent de synthèse de la scène ``meta_checkpoint`` (A2).

Produit un ``MetaCheckpointScene`` Pydantic (cf. ``scene_synth_schemas``)
à partir d'une section de plan et d'un contexte. La scène calibre la
métacognition de l'apprenant·e (confiance avant/après).
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import MetaCheckpointScene

from .base import SceneAgent


class MetaCheckpointAgent(SceneAgent):
    scene_type = "meta_checkpoint"
    prompt_path = Path(__file__).parent.parent / "prompts" / "meta_checkpoint.j2"

    def _validate(self, raw: str) -> MetaCheckpointScene:
        return MetaCheckpointScene.model_validate(json.loads(raw))
