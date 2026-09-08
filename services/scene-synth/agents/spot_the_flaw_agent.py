"""Agent de synthèse de la scène ``spot_the_flaw`` — capsule-grounded JUDGMENT scene.

Philosophie anti-offloading (ADR 001/004) : l'agent génère une LECTURE IA
DÉFECTUEUSE d'un résultat exécuté RÉEL (``plan_section['reference_run']``, produit
par tools/capsule_runner.py) **sans révéler les défauts**. L'étudiant audite cette
lecture contre la sortie réelle ; le ``flawGrader`` la note *a posteriori*. C'est la
vision « capsule-backed lesson » : l'opération réelle est le *véhicule*, le jugement
calibré est la *destination*.

Le « cadran de fiabilité » (``plan_section['trustworthiness']`` : level / n_flaws /
guidance) est rendu dans le prompt — le NOMBRE et la subtilité des défauts sont donc
*paramétrables par l'auteur*, pas codés en dur. Varier délibérément la fiabilité des
sorties est ce qui rend la calibration de l'étudiant mesurable (étape ultérieure).

L'ANCRAGE lui-même (``reference_result``) est attaché par tools/ground_judgment.py à
partir du run réel — pas par le LLM — donc le résultat exécuté que l'étudiant voit est
une donnée vérifiée, pas une hallucination ; le LLM n'écrit que l'*interprétation*.
"""

from __future__ import annotations

import json
from pathlib import Path

from scene_synth_schemas import SpotTheFlawScene

from .base import SceneAgent


class SpotTheFlawAgent(SceneAgent):
    scene_type = "spot_the_flaw"
    prompt_path = Path(__file__).parent.parent / "prompts" / "spot_the_flaw.j2"

    def _validate(self, raw: str) -> SpotTheFlawScene:
        return SpotTheFlawScene.model_validate(json.loads(raw))
