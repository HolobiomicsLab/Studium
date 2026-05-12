"""Agent de synthèse de la scène ``quiz`` (A2).

Produit un ``QuizScene`` Pydantic (cf. ``scene_synth_schemas``) à partir
d'une section de plan et d'un contexte.
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import QuizScene

from .base import SceneAgent


class QuizAgent(SceneAgent):
    scene_type = "quiz"
    prompt_path = Path(__file__).parent.parent / "prompts" / "quiz.j2"

    def _validate(self, raw: str) -> QuizScene:
        return QuizScene.model_validate(json.loads(raw))
