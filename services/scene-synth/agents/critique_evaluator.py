"""Évaluateur de critique étudiante (A2 — A.5).

Distinct de ``SceneAgent`` : ne synthétise pas une scène, il *note* a posteriori
la critique produite par l'étudiant face aux affirmations d'une scène
``ai_critique``. Sera exposé par l'endpoint FastAPI ``/scenes/critique-eval``
en A.7.

Philosophie ADR 001/004 — anti-offloading : l'IA n'écrit pas la critique à
la place de l'étudiant ; elle évalue ce qu'il a produit.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from jinja2 import Template


@dataclass
class CritiqueResult:
    score: float
    feedback: str


class CritiqueEvaluator:
    """Évalue la critique étudiante via un LLM scorer.

    Le LLM reçoit (claims, rubric, student_critique) et retourne un JSON
    ``{"score": float, "feedback": str}``. Le score est clipé dans [0, 1].
    """

    prompt_path = Path(__file__).parent.parent / "prompts" / "critique_eval.j2"

    def __init__(self, llm_client):
        self.llm = llm_client
        self._template = Template(self.prompt_path.read_text())

    def evaluate(
        self,
        claims: list[dict],
        rubric: dict,
        student_critique: str,
    ) -> CritiqueResult:
        prompt = self._template.render(
            claims=claims,
            rubric=rubric,
            student_critique=student_critique,
        )
        raw = self.llm.complete(prompt)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"LLM returned non-JSON: {raw!r}") from e

        try:
            score = float(data.get("score", 0))
        except (TypeError, ValueError) as e:
            raise ValueError(f"LLM 'score' field is not numeric: {data!r}") from e
        score = max(0.0, min(1.0, score))  # clip dans [0, 1]

        feedback = str(data.get("feedback", ""))
        if not feedback:
            raise ValueError("LLM response missing 'feedback' field")

        return CritiqueResult(score=score, feedback=feedback)
