# predictor.py — the BEA guidance/actionability detector under validation. Pure stdlib.
from __future__ import annotations

import re
from typing import Dict, List, Sequence

from eval.validity.bea_external.agreement import binary_scores, cohen_kappa
from eval.validity.bea_external.loader import TeacherTurn

# FROZEN audit baseline: a byte-faithful copy of bea_tutor's imperative-only _NEXT_STEP
# AS OF the audit (commit 14ea6f3). The audit must be REPRODUCIBLE independent of how
# bea_tutor later evolves — otherwise adopting the recommendation back into bea_tutor would
# silently move the "before" number. So we freeze the baseline here rather than importing
# the (now-improved) score_actionability. The audit it produced (f1=0.126, recall=0.071)
# motivated adding interrogatives to bea_tutor; this frozen copy keeps that evidence stable.
_IMPERATIVE_BASELINE = re.compile(
    r"\b(essaie|essaye|consid[eè]re|teste|compare|v[eé]rifie|imagine|reformule|montre|"
    r"try|consider|test|compare|check|imagine|explain|describe|list)\b|et si\b|what if\b",
    re.IGNORECASE,
)


def predict_guiding(text: str, extra_terms: Sequence[str] = ()) -> bool:
    """Predict 'this is a guiding move'. Baseline = the frozen imperative detector;
    extra_terms expand it (e.g. interrogatives the baseline misses)."""
    if _IMPERATIVE_BASELINE.search(text or ""):
        return True
    low = (text or "").lower()
    return any(term in low for term in extra_terms)


def evaluate(turns: List[TeacherTurn], extra_terms: Sequence[str] = ()) -> Dict[str, float]:
    gold = [t.is_guiding for t in turns]
    pred = [predict_guiding(t.text, extra_terms) for t in turns]
    s = binary_scores(gold, pred)
    s["kappa"] = cohen_kappa(gold, pred)
    return s
