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
