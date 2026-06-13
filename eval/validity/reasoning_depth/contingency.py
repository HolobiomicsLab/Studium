# contingency.py — FUSION axis: did the tutor move fit the learner signal? Pure stdlib.
# IDEAL_MOVE mirrors packages/lesson-session/src/socratic-tutor/contingency.ts (MOVE_FOR_SIGNAL).
from __future__ import annotations

from typing import Dict, List, Optional

IDEAL_MOVE: Dict[str, str] = {
    "justification": "probe_justification",
    "hypothesis": "invite_test",
    "question": "redirect_question",
    "counterexample": "acknowledge_extend",
    "synthesis": "probe_synthesis",
}


def _is_revealed(ev: Dict) -> bool:
    return bool(ev.get("revealed") or ev.get("reveal_blocked"))


def _is_contingent(ev: Dict) -> bool:
    """Contingent if NOT revealed AND (move == ideal-for-signal OR scaffold_hint).

    scaffold_hint is always acceptable: it is the low-confidence fallback move and the
    lowest-commitment, hardest-to-reveal response (matches the runtime's confidence gate).
    """
    if _is_revealed(ev):
        return False
    mk = ev.get("move_kind")
    sig = ev.get("in_reply_to_signal")
    return mk == "scaffold_hint" or mk == IDEAL_MOVE.get(sig)


def contingency(tutor_move_events: List[Dict]) -> dict:
    n = len(tutor_move_events)
    if n == 0:
        return {"n_moves": 0, "rate": None, "reveal_violations": 0, "per_signal": {}}
    contingent = sum(1 for e in tutor_move_events if _is_contingent(e))
    reveals = sum(1 for e in tutor_move_events if _is_revealed(e))
    per: Dict[str, Dict[str, int]] = {}
    for e in tutor_move_events:
        sig = e.get("in_reply_to_signal", "?")
        d = per.setdefault(sig, {"n": 0, "contingent": 0})
        d["n"] += 1
        if _is_contingent(e):
            d["contingent"] += 1
    return {"n_moves": n, "rate": contingent / n, "reveal_violations": reveals, "per_signal": per}
