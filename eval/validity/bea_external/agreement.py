# agreement.py — binary-classification agreement metrics. Pure stdlib.
from __future__ import annotations

from typing import Dict, List


def binary_scores(gold: List[bool], pred: List[bool]) -> Dict[str, float]:
    tp = sum(1 for g, p in zip(gold, pred) if g and p)
    fp = sum(1 for g, p in zip(gold, pred) if not g and p)
    fn = sum(1 for g, p in zip(gold, pred) if g and not p)
    tn = sum(1 for g, p in zip(gold, pred) if not g and not p)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
    n = len(gold)
    acc = (tp + tn) / n if n else 0.0
    return {"n": n, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": prec, "recall": rec, "f1": f1, "accuracy": acc}


def cohen_kappa(gold: List[bool], pred: List[bool]) -> float:
    """Cohen's kappa for two binary raters. 0 on empty / degenerate."""
    n = len(gold)
    if n == 0:
        return 0.0
    po = sum(1 for g, p in zip(gold, pred) if g == p) / n
    pg = sum(gold) / n
    pp = sum(pred) / n
    pe = pg * pp + (1 - pg) * (1 - pp)
    if pe >= 1.0:
        return 0.0
    return (po - pe) / (1 - pe)


def quadratic_weighted_kappa(a: List[float], b: List[float], categories: List[float]) -> float:
    """QWK over a shared ordered category set. 1.0 = perfect; 0 = chance; <0 = worse.

    Both rating lists must take values within `categories` (ordered low→high). Empty /
    single-category degenerate inputs return 0.0.
    """
    k = len(categories)
    n = len(a)
    if n == 0 or k < 2:
        return 0.0
    idx = {c: i for i, c in enumerate(categories)}
    # observed + marginals
    O = [[0 for _ in range(k)] for _ in range(k)]
    ra = [0] * k
    rb = [0] * k
    for x, y in zip(a, b):
        i, j = idx[x], idx[y]
        O[i][j] += 1
        ra[i] += 1
        rb[j] += 1
    num = 0.0
    den = 0.0
    for i in range(k):
        for j in range(k):
            w = ((i - j) ** 2) / ((k - 1) ** 2)
            e = ra[i] * rb[j] / n
            num += w * O[i][j]
            den += w * e
    if den == 0:
        return 0.0
    return 1.0 - num / den
