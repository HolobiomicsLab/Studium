# trajectory.py — LEARNER axis: is deeper reasoning being elicited over time? Pure stdlib.
from __future__ import annotations

import math
from typing import Dict, List, Optional

# Ordinal depth ladder (an assumption, published beside the histogram so it is auditable).
DEPTH_RANK: Dict[str, int] = {
    "question": 1, "justification": 2, "hypothesis": 3, "counterexample": 4, "synthesis": 5,
}
_SIGNALS = list(DEPTH_RANK.keys())


def signal_histogram(signal_events: List[Dict]) -> Dict[str, int]:
    h = {s: 0 for s in _SIGNALS}
    for e in signal_events:
        s = e.get("signal")
        if s in h:
            h[s] += 1
    return h


def signal_entropy(signal_events: List[Dict]) -> float:
    """Shannon entropy (bits) of the signal distribution — diversity, not collapse."""
    h = signal_histogram(signal_events)
    total = sum(h.values())
    if total == 0:
        return 0.0
    ent = 0.0
    for c in h.values():
        if c:
            p = c / total
            ent -= p * math.log2(p)
    return ent


def depth_slope(signal_events: List[Dict]) -> Optional[float]:
    """OLS slope of depth_rank over turn_index (>0 = deepening). None if <2 points."""
    pts = [(float(e.get("turn_index", 0)), float(DEPTH_RANK[e["signal"]]))
           for e in signal_events if e.get("signal") in DEPTH_RANK]
    n = len(pts)
    if n < 2:
        return None
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    var = sum((x - mx) ** 2 for x, _ in pts)
    if var == 0:
        return None
    cov = sum((x - mx) * (y - my) for x, y in pts)
    return cov / var


def target_coverage(signal_events: List[Dict], bundle: dict) -> Optional[float]:
    """Fraction of discussion target_signals actually elicited. None if no targets in bundle."""
    targets = set()
    if isinstance(bundle, dict):
        for sc in bundle.get("scenes", []) or []:
            if isinstance(sc, dict) and sc.get("type") == "discussion":
                for t in sc.get("target_signals", []) or []:
                    targets.add(t)
    if not targets:
        return None
    elicited = {e.get("signal") for e in signal_events}
    return len(targets & elicited) / len(targets)
