# bea.py — BEA 8-dimension tutor-move rubric (verbatim names). Pure stdlib.
from __future__ import annotations

import re
from typing import List, Optional

from eval.validity.bea_tutor.reveal_rule import jaccard, reveals_answer, tokenize

# Imperative/next-step cues (FR + EN) for actionability (#5).
_NEXT_STEP = re.compile(
    r"\b(essaie|essaye|consid[eè]re|teste|compare|v[eé]rifie|imagine|reformule|montre|"
    r"try|consider|test|compare|check|imagine|explain|describe|list)\b|et si\b|what if\b",
    re.IGNORECASE,
)


def score_revealing_answer(text: str, banned: List[str]) -> dict:
    """BEA #3 revealing-the-answer — DETERMINISTIC PENALTY. score 1.0 = revealed (BAD)."""
    revealed = reveals_answer(text, banned)
    return {"dim": "revealing_answer", "mode": "deterministic", "penalty": True,
            "revealed": revealed, "score": 1.0 if revealed else 0.0}


def score_actionability(text: str) -> dict:
    """BEA #5 actionability — DETERMINISTIC. 1.0 if a concrete next step is present."""
    has = bool(_NEXT_STEP.search(text or ""))
    return {"dim": "actionability", "mode": "deterministic", "score": 1.0 if has else 0.0}
