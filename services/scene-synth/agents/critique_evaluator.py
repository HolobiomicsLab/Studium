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
from typing import Optional

from jinja2 import Template
from pydantic import StrictStr, TypeAdapter, ValidationError

# ``covered_ids`` must be a list of strings, none coerced: ``[1, 2]`` or ``"c1"`` is a malformed
# judgement, not a lenient one.
_COVERED_IDS = TypeAdapter(list[StrictStr])


@dataclass
class CritiqueResult:
    score: float
    feedback: str
    # Ids of the request's claims (or key points) the judge found covered, in judged order, without
    # duplicates and without ids the request never carried. The caller builds the learner's
    # "n/m covered" count from them. ``[]`` means the judge measured coverage and found none covered;
    # ``None`` means the judge did not measure it (the reply carried no ``covered_ids``): the score
    # is still the judge's, and the client counts with its keywords for the count only.
    covered_ids: Optional[list[str]] = None


class CritiqueEvaluator:
    """Évalue la critique étudiante via un LLM scorer.

    Le LLM reçoit (claims, rubric, student_critique) et retourne un JSON
    ``{"score": float, "feedback": str, "covered_ids": [str]}``. Le score est clipé dans [0, 1].
    ``covered_ids`` est validé par Pydantic puis restreint aux ids de la requête. Absent, il
    signifie « non mesuré » (``None``) : le score du juge est conservé et le client compte avec ses
    mots-clés, au lieu de lire « aucun point couvert ». Présent mais mal formé, il est refusé
    (ValueError, l'endpoint répond 502 et le client retombe sur ses mots-clés).
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

        return CritiqueResult(
            score=score,
            feedback=feedback,
            covered_ids=self._covered_ids(data, claims),
        )

    @staticmethod
    def _covered_ids(data: dict, claims: list[dict]) -> Optional[list[str]]:
        if "covered_ids" not in data:
            return None  # not measured: neither "nothing covered" nor a reason to drop the score
        try:
            judged = _COVERED_IDS.validate_python(data["covered_ids"], strict=True)
        except ValidationError as e:
            raise ValueError(f"LLM 'covered_ids' field is not a list of ids: {data!r}") from e
        known = {str(claim.get("id")) for claim in claims}
        # dict.fromkeys keeps the judged order while dropping repeats
        return [claim_id for claim_id in dict.fromkeys(judged) if claim_id in known]
