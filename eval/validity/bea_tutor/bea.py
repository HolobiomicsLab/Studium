# bea.py — BEA 8-dimension tutor-move rubric (verbatim names). Pure stdlib.
from __future__ import annotations

import re
from typing import List, Optional

from eval.validity.bea_tutor.reveal_rule import jaccard, reveals_answer, tokenize

# Imperative/next-step + guiding-interrogative cues (FR + EN) for actionability (#5).
# The interrogatives + "?" were ADDED after the EV-8a MathDial audit: the imperative-only
# detector had recall 0.071 on guiding moves because guiding QUESTIONS (which dominate the
# 'probing' gold move) carry no imperative verb. Adding the domain-neutral interrogative set
# (gate: domain_neutral=True) lifted held-out F1 0.126 -> 0.774 (recall -> 0.839). A guiding
# question IS actionable — it directs the learner's next thinking step.
# Evidence: eval/validity/bea_external/external_result.json.
_NEXT_STEP = re.compile(
    r"\b(essaie|essaye|consid[eè]re|teste|compare|v[eé]rifie|imagine|reformule|montre|"
    r"try|consider|test|compare|check|imagine|explain|describe|list|"
    r"how|why|what|which|where|who|when|"
    r"comment|pourquoi|combien|quel|quelle|quand)\b|et si\b|what if\b|\?",
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


from dataclasses import dataclass, field

# The 8 BEA dimensions, VERBATIM (never rename — benchmarkable vs MRBench/MathTutorBench).
BEA_DIMENSIONS = [
    "mistake_identification", "mistake_location", "revealing_answer", "guidance",
    "actionability", "coherence", "tone", "human_likeness",
]


@dataclass
class TutorMoveRecord:
    text: str
    move_kind: str
    in_reply_to_signal: Optional[str] = None
    learner_turn: Optional[str] = None
    banned: List[str] = field(default_factory=list)
    source: str = "authored"          # "authored" | "live"
    reveal_blocked: Optional[bool] = None


def score_move(move: TutorMoveRecord) -> dict:
    """Assemble the per-move BeaCard over all 8 verbatim BEA dimensions.

    Deterministic dims (#3, #5, #7-redflag) carry a real score; LLM-gated dims carry
    score=None + a deterministic floor. ``summative_safe`` is True iff the move did
    NOT reveal and did NOT trip the tone red-flag — the only claims defensible today.
    """
    dims = {
        "mistake_identification": score_mistake_identification(move.text, move.learner_turn),
        "mistake_location": score_mistake_location(move.text, move.learner_turn),
        "revealing_answer": score_revealing_answer(move.text, move.banned),
        "guidance": score_guidance(move.text, move.banned),
        "actionability": score_actionability(move.text),
        "coherence": score_coherence(move.text, move.learner_turn),
        "tone": score_tone(move.text),
        "human_likeness": {"dim": "human_likeness", "mode": "llm_formative", "gated": "EV-5", "score": None},
    }
    revealed = dims["revealing_answer"]["revealed"]
    tone_red = dims["tone"].get("red_flag", False)
    return {"move_kind": move.move_kind, "in_reply_to_signal": move.in_reply_to_signal,
            "source": move.source, "dims": dims, "summative_safe": (not revealed and not tone_red)}


from eval.validity.bea_tutor.loaders import authored_scaffolding_moves

_HONEST_NOTE = (
    "BEA dims #3 (revealing-answer) and #5 (actionability), the lexical floors on "
    "#1/#2/#4/#6 and the #7 tone red-flag screen are DETERMINISTIC and summative-safe. "
    "The quality halves of #1/#2/#4/#6, positive #7 and all of #8 are LLM-judged and "
    "FORMATIVE-ONLY until the EV-5/D16 human-agreement study. Dimension names are "
    "verbatim BEA (MRBench/MathTutorBench-comparable). reveal uses a lexical proxy "
    "(shared with the TS runtime guardrail), not a semantic match."
)


def score_bundle(bundle: dict) -> dict:
    """Score a bundle's authored scaffolding. Returns cards + aggregate reveal_rate."""
    moves = authored_scaffolding_moves(bundle)
    cards = [score_move(m) for m in moves]
    n = len(cards)
    reveals = sum(1 for c in cards if c["dims"]["revealing_answer"]["revealed"])
    actionable = sum(1 for c in cards if c["dims"]["actionability"]["score"] == 1.0)
    return {"n_moves": n, "reveal_rate": (reveals / n) if n else 0.0,
            "actionability_rate": (actionable / n) if n else 0.0,
            "summative_safe_rate": (sum(1 for c in cards if c["summative_safe"]) / n) if n else 0.0,
            "cards": cards, "note": _HONEST_NOTE}
