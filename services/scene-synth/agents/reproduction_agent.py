"""Agent de synthèse de la scène ``reproduction`` (A2 — A.4).

Premier agent A2 qui consomme une capsule ABS (RO-Crate) : surcharge
``synthesize`` pour charger le ``task_card`` correspondant à
``plan_section["abs_task_card_id"]`` via ``abs_loader.load_task_card``,
puis l'injecte dans le rendu du prompt.

En cas d'``abs_task_card_id`` introuvable dans la capsule, un avertissement
non-bloquant est ajouté à ``context["warnings"]`` (la synthèse continue,
le LLM générera une scène avec un ``task_card`` vide).
"""

from __future__ import annotations

import json
from pathlib import Path

from abs_loader import load_task_card
from scene_synth_schemas import ReproductionScene

from .base import SceneAgent


class ReproductionAgent(SceneAgent):
    scene_type = "reproduction"
    prompt_path = Path(__file__).parent.parent / "prompts" / "reproduction.j2"

    def __init__(self, llm_client, critic, abs_capsule_root: Path):
        super().__init__(llm_client, critic)
        self.abs_capsule_root = abs_capsule_root

    def synthesize(self, plan_section: dict, context: dict) -> ReproductionScene:
        task_id = plan_section.get("abs_task_card_id")
        task_card = (
            load_task_card(self.abs_capsule_root, task_id) if task_id else None
        )
        if task_id and task_card is None:
            context.setdefault("warnings", []).append(
                f"ABS task_card '{task_id}' not found in capsule"
            )
        enriched = {**plan_section, "task_card": task_card or {}}
        return super().synthesize(enriched, context)

    def _validate(self, raw: str) -> ReproductionScene:
        return ReproductionScene.model_validate(json.loads(raw))
