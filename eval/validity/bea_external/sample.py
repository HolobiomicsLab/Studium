# sample.py — deterministic stratified sampling across MathDial move types. Pure stdlib.
from __future__ import annotations

from typing import Dict, List

from eval.validity.bea_external.loader import TeacherTurn

_MOVES = ["focus", "probing", "telling", "generic"]


def stratified_sample(turns: List[TeacherTurn], n_per_move: int, seed: int = 0) -> List[TeacherTurn]:
    """Up to n_per_move turns from each move type, balanced. Deterministic (seed rotates the
    per-move list before taking the head — no RNG, so resumable/reproducible)."""
    by_move: Dict[str, List[TeacherTurn]] = {m: [] for m in _MOVES}
    for t in turns:
        if t.move in by_move:
            by_move[t.move].append(t)
    out: List[TeacherTurn] = []
    for m in _MOVES:
        pool = by_move[m]
        if not pool:
            continue
        rot = seed % len(pool)
        rotated = pool[rot:] + pool[:rot]
        out.extend(rotated[:n_per_move])
    return out
