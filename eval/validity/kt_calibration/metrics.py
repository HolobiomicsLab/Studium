"""metrics.py — calibration metrics in pure Python (no numpy / sklearn).

- ``brier``    : mean squared error between predicted prob and outcome.
- ``auc``      : ROC-AUC via the rank / Mann-Whitney U formula, tie-aware.
- ``accuracy`` : threshold accuracy (default 0.5).
"""

from __future__ import annotations

from typing import List, Sequence


def brier(y_true: Sequence[int], p: Sequence[float]) -> float:
    """Brier score = mean((p - y)^2). Lower is better; 0 is perfect."""
    if len(y_true) != len(p):
        raise ValueError("y_true and p must have equal length")
    if not y_true:
        raise ValueError("brier requires at least one observation")
    return sum((pi - yi) ** 2 for yi, pi in zip(y_true, p)) / len(y_true)


def _average_ranks(scores: Sequence[float]) -> List[float]:
    """Return 1-based ranks (ascending) with ties resolved to their average."""
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    n = len(scores)
    while i < n:
        j = i
        # advance over a run of equal scores
        while j + 1 < n and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        # ranks for positions i..j (1-based) averaged
        avg = (i + j + 2) / 2.0  # ((i+1) + (j+1)) / 2
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def auc(y_true: Sequence[int], p: Sequence[float]) -> float:
    """ROC-AUC via the Mann-Whitney U statistic.

        auc = (sum_ranks_pos - n_pos*(n_pos+1)/2) / (n_pos * n_neg)

    Ties in ``p`` use averaged ranks. The degenerate all-one-class case
    (no positives or no negatives) returns 0.5.
    """
    if len(y_true) != len(p):
        raise ValueError("y_true and p must have equal length")
    n_pos = sum(1 for y in y_true if y == 1)
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return 0.5
    ranks = _average_ranks(p)
    sum_ranks_pos = sum(r for r, y in zip(ranks, y_true) if y == 1)
    return (sum_ranks_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def accuracy(y_true: Sequence[int], p: Sequence[float], thresh: float = 0.5) -> float:
    """Fraction of predictions correct after thresholding ``p`` at ``thresh``
    (``p >= thresh`` predicts 1)."""
    if len(y_true) != len(p):
        raise ValueError("y_true and p must have equal length")
    if not y_true:
        raise ValueError("accuracy requires at least one observation")
    hits = sum(1 for y, pi in zip(y_true, p) if (1 if pi >= thresh else 0) == y)
    return hits / len(y_true)
