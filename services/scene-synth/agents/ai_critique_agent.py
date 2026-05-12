"""Agent de synthèse de la scène ``ai_critique`` (A2 — A.5).

Philosophie anti-offloading (ADR 001/004) : l'agent génère des affirmations
imparfaites/biaisées sans révéler les défauts. C'est l'étudiant qui produit
la critique ; un évaluateur (cf. ``critique_evaluator``) la note *a posteriori*.
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import AICritiqueScene

from .base import SceneAgent


class AICritiqueAgent(SceneAgent):
    scene_type = "ai_critique"
    prompt_path = Path(__file__).parent.parent / "prompts" / "ai_critique.j2"

    def _validate(self, raw: str) -> AICritiqueScene:
        return AICritiqueScene.model_validate(json.loads(raw))
