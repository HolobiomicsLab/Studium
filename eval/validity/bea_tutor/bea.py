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


_ERROR_CUE = re.compile(
    r"\b(non|pas|erreur|incorrect|incorrecte|faux|fausse|attention|mais|"
    r"no|not|wrong|incorrect|mistake|however|but)\b", re.IGNORECASE,
)
_INSULTS = re.compile(r"\b(idiot|stupide|nul|b[eê]te|dumb|stupid|idiot|useless)\b", re.IGNORECASE)


def _overlaps(text: str, learner_turn: Optional[str]) -> bool:
    if not learner_turn:
        return False
    return jaccard(tokenize(text), tokenize(learner_turn)) > 0.0


def _floor(condition: bool, dim: str) -> dict:
    return {"dim": dim, "mode": "llm_formative", "gated": "EV-5", "score": None,
            "floor": 0.5 if condition else 0.0}


def score_mistake_identification(text: str, learner_turn: Optional[str]) -> dict:
    """BEA #1 — LLM-gated; deterministic FLOOR: an error cue AND it engages the learner turn."""
    return _floor(bool(_ERROR_CUE.search(text or "")) and _overlaps(text, learner_turn), "mistake_identification")


def score_mistake_location(text: str, learner_turn: Optional[str]) -> dict:
    """BEA #2 — LLM-gated; floor: shares a specific token with the learner turn (points at a span)."""
    return _floor(_overlaps(text, learner_turn), "mistake_location")


def score_guidance(text: str, banned: List[str]) -> dict:
    """BEA #4 — LLM-gated; floor: a strategy/next-step cue present AND not a reveal."""
    cue = bool(_NEXT_STEP.search(text or ""))
    return _floor(cue and not reveals_answer(text, banned), "guidance")


def score_coherence(text: str, learner_turn: Optional[str]) -> dict:
    """BEA #6 — LLM-gated; floor: lexical overlap with the learner turn (engages THIS turn)."""
    return _floor(_overlaps(text, learner_turn), "coherence")


def score_tone(text: str) -> dict:
    """BEA #7 — deterministic red-flag screen (insults/shouting → 0); positive tone → LLM."""
    shouting = sum(1 for c in (text or "") if c.isupper()) >= 8 and (text or "").upper() == (text or "")
    if _INSULTS.search(text or "") or shouting:
        return {"dim": "tone", "mode": "deterministic", "score": 0.0, "red_flag": True}
    return {"dim": "tone", "mode": "llm_formative", "gated": "EV-5", "score": None}
