"""baselines.py — reference predictors to compare the Beta model against.

- ``BKTModel``        : standard Bayesian Knowledge Tracing with FIXED params.
- ``RunningMeanModel``: trivial running-mean floor any real model must beat.

Both expose the same surface as ``BetaModel`` so the calibration replay loop
treats them interchangeably: ``predict(student, skill) -> p`` and
``update(student, skill, correct, w, hints=0)`` (``w``/``hints`` ignored where
not used).
"""

from __future__ import annotations

from typing import Dict, Tuple


class BKTModel:
    """Bayesian Knowledge Tracing (4-parameter) with FIXED params per skill.

    Parameters (documented as a future EM-fitting refinement):
      - ``p_l0`` : P(skill already learned at start)
      - ``p_t``  : P(transit) — probability of learning on each opportunity
      - ``p_g``  : P(guess)    — answering correctly while not-learned
      - ``p_s``  : P(slip)     — answering wrong while learned

    Prediction (probability of a correct answer):
        P(correct) = P(L) * (1 - S) + (1 - P(L)) * G

    After observing the answer, Bayes-update the latent P(L) given the
    observation, then apply the learning transit P(L) <- P(L) + (1-P(L)) * T.
    """

    def __init__(
        self,
        p_l0: float = 0.3,
        p_t: float = 0.1,
        p_g: float = 0.2,
        p_s: float = 0.1,
    ) -> None:
        self.p_l0 = p_l0
        self.p_t = p_t
        self.p_g = p_g
        self.p_s = p_s
        self._pl: Dict[Tuple[str, str], float] = {}

    def _get(self, student: str, skill: str) -> float:
        return self._pl.get((student, skill), self.p_l0)

    def predict(self, student: str, skill: str) -> float:
        pl = self._get(student, skill)
        return pl * (1.0 - self.p_s) + (1.0 - pl) * self.p_g

    def update(
        self,
        student: str,
        skill: str,
        correct: int,
        w: float = 0.0,
        hints: int = 0,
    ) -> None:
        pl = self._get(student, skill)
        if correct:
            # P(L | correct) = P(L)(1-S) / [P(L)(1-S) + (1-P(L))G]
            num = pl * (1.0 - self.p_s)
            den = num + (1.0 - pl) * self.p_g
        else:
            # P(L | wrong) = P(L)S / [P(L)S + (1-P(L))(1-G)]
            num = pl * self.p_s
            den = num + (1.0 - pl) * (1.0 - self.p_g)
        pl_post = num / den if den > 0 else pl
        # learning transit
        pl_next = pl_post + (1.0 - pl_post) * self.p_t
        self._pl[(student, skill)] = pl_next


class RunningMeanModel:
    """Trivial floor: predict the running mean correctness for (student, skill).

    Starts from a prior of 0.5 (one pseudo-observation each way) and tracks the
    empirical mean of observed outcomes. Carries NO notion of learning order —
    that is exactly why a model that tracks learning should beat it.
    """

    def __init__(self, prior: float = 0.5) -> None:
        self.prior = prior
        # store (sum_correct, n) with a single pseudo-count seeding the prior
        self._acc: Dict[Tuple[str, str], list] = {}

    def _get(self, student: str, skill: str) -> list:
        key = (student, skill)
        acc = self._acc.get(key)
        if acc is None:
            # seed: prior counts as 1 pseudo-observation at value `prior`
            acc = [self.prior, 1.0]
            self._acc[key] = acc
        return acc

    def predict(self, student: str, skill: str) -> float:
        s, n = self._get(student, skill)
        return s / n

    def update(
        self,
        student: str,
        skill: str,
        correct: int,
        w: float = 0.0,
        hints: int = 0,
    ) -> None:
        acc = self._get(student, skill)
        acc[0] += correct
        acc[1] += 1.0
