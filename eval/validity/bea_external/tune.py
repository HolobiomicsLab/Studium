# tune.py — held-out improve loop over the guidance-predictor lexicon. Pure stdlib.
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

from eval.validity.bea_external.loader import TeacherTurn
from eval.validity.bea_external.predictor import evaluate

# Candidate lexicon extensions (interrogatives the baseline _NEXT_STEP misses).
DEFAULT_CANDIDATES: List[Tuple[str, ...]] = [
    (),
    ("?",),
    ("how", "why", "what", "which", "where", "?"),
    ("how", "why", "what", "which", "where", "comment", "pourquoi", "combien", "quel", "?"),
]

_GATE_NOTE = (
    "Lexicon additions are tuned on MATH-only MathDial; before adopting them in the shipped "
    "bea_tutor detector, confirm they are domain-NEUTRAL (generic interrogatives / imperatives, "
    "not math vocabulary). This report SURFACES the recommendation; it does not auto-edit bea_tutor."
)


def split_by_qid(turns: List[TeacherTurn], test_frac: float = 0.3, seed: int = 0):
    """Split so a whole dialogue (qid) is in train XOR test (no turn-level leakage)."""
    qids = sorted({t.qid for t in turns})
    # deterministic pseudo-shuffle without Math.random/Date: rotate by seed then stride
    order = qids[seed % len(qids):] + qids[: seed % len(qids)] if qids else []
    n_test = int(len(order) * test_frac)
    test_qids = set(order[:n_test])
    train = [t for t in turns if t.qid not in test_qids]
    test = [t for t in turns if t.qid in test_qids]
    return train, test


def _is_domain_neutral(terms: Sequence[str]) -> bool:
    """A gate: every term is a generic interrogative/punctuation, not a domain word."""
    allowed = {"?", "how", "why", "what", "which", "where", "who", "when",
               "comment", "pourquoi", "combien", "quel", "quelle", "où", "qui", "quand"}
    return all(t.lower() in allowed for t in terms)


def improve(turns: List[TeacherTurn], candidates: List[Tuple[str, ...]] = None,
            test_frac: float = 0.3, seed: int = 0) -> Dict:
    cands = candidates if candidates is not None else DEFAULT_CANDIDATES
    train, test = split_by_qid(turns, test_frac=test_frac, seed=seed)
    # pick the candidate maximizing TRAIN f1 (gated to domain-neutral term sets)
    best, best_f1 = (), -1.0
    for c in cands:
        if c and not _is_domain_neutral(c):
            continue
        f1 = evaluate(train, c)["f1"]
        if f1 > best_f1:
            best, best_f1 = c, f1
    return {
        "baseline": evaluate(test, ()),                 # on held-out TEST
        "improved": evaluate(test, best),               # on held-out TEST
        "chosen_extra_terms": list(best),
        "domain_neutral": _is_domain_neutral(best),
        "n_train": len(train), "n_test": len(test),
        "note": _GATE_NOTE,
    }
