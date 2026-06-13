# predictor.py — the BEA guidance/actionability detector under validation. Pure stdlib.
from __future__ import annotations

from typing import Dict, List, Sequence

from eval.validity.bea_tutor.bea import score_actionability
from eval.validity.bea_external.agreement import binary_scores, cohen_kappa
from eval.validity.bea_external.loader import TeacherTurn


def predict_guiding(text: str, extra_terms: Sequence[str] = ()) -> bool:
    """Predict 'this is a guiding move'. Baseline = bea_tutor actionability (#5);
    extra_terms expand the detector (e.g. interrogatives the baseline misses)."""
    if score_actionability(text)["score"] == 1.0:
        return True
    low = (text or "").lower()
    return any(term in low for term in extra_terms)


def evaluate(turns: List[TeacherTurn], extra_terms: Sequence[str] = ()) -> Dict[str, float]:
    gold = [t.is_guiding for t in turns]
    pred = [predict_guiding(t.text, extra_terms) for t in turns]
    s = binary_scores(gold, pred)
    s["kappa"] = cohen_kappa(gold, pred)
    return s
