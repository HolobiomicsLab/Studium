"""beta_model.py — EXACT Python reimplementation of the production Beta-updater.

Mirrors `packages/adaptation-engine/src/beta-updater.ts` exactly.

Per (student, skill) we keep a Beta state ``(alpha, beta)`` initialised to
``(1.0, 1.0)`` (a uniform prior, mean 0.5). The probability that the student
answers the next item on this skill correctly is the Beta mean::

    P(correct) = alpha / (alpha + beta)

This prediction is made BEFORE the answer is observed. AFTER observing, the
state is updated following the production rules (TS source reproduced here)::

    correct: alpha += ((1 - w) + 1) / (1 + hint_count)   == (2 - w) / (1 + hints)
    wrong:   beta  += w + 1

where ``w`` is the item difficulty in ``[0, 1]``. In the production engine ``w``
comes from a Bloom-level mapping; KT benchmark datasets have no Bloom level, so
the calibration harness estimates a per-skill difficulty ``w = 1 - p_correct``
(see ``run_calibration.py``). ``hint_count`` is 0 for KT data (no hint signal).

This module is intentionally dependency-free (pure stdlib) for portability.
"""

from __future__ import annotations

from typing import Dict, Tuple

ALPHA0 = 1.0
BETA0 = 1.0


class BetaModel:
    """Beta-Bernoulli learner model, one ``(alpha, beta)`` state per
    ``(student, skill)`` pair."""

    def __init__(self) -> None:
        self._states: Dict[Tuple[str, str], list] = {}

    def _get(self, student: str, skill: str) -> list:
        key = (student, skill)
        st = self._states.get(key)
        if st is None:
            st = [ALPHA0, BETA0]
            self._states[key] = st
        return st

    def state(self, student: str, skill: str) -> Tuple[float, float]:
        """Return the current ``(alpha, beta)`` for this pair (init if unseen)."""
        a, b = self._get(student, skill)
        return (a, b)

    def predict(self, student: str, skill: str) -> float:
        """P(correct) = alpha / (alpha + beta), BEFORE observing the answer."""
        a, b = self._get(student, skill)
        return a / (a + b)

    def update(
        self,
        student: str,
        skill: str,
        correct: int,
        w: float,
        hints: int = 0,
    ) -> None:
        """Apply the production Beta update AFTER observing the answer."""
        st = self._get(student, skill)
        if correct:
            st[0] += ((1.0 - w) + 1.0) / (1.0 + hints)
        else:
            st[1] += w + 1.0
