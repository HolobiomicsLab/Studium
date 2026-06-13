# scorecard.py — assemble the 3-axis hybrid reasoning_depth vector. NEVER a fused scalar.
from __future__ import annotations

from typing import Dict, List, Optional

from eval.validity.reasoning_depth.telemetry import events_of_type
from eval.validity.reasoning_depth.trajectory import (
    signal_histogram, depth_slope, signal_entropy, target_coverage,
)
from eval.validity.reasoning_depth.contingency import contingency

_NOTE = (
    "A VECTOR over three orthogonal axes, never fused to a scalar: a tutor that REVEALS "
    "the answer can spike the learner trajectory (offloading masquerading as depth), so "
    "reveal is a HARD VETO, not a summand. trajectory + contingency are deterministic; "
    "tutor_quality folds the EV-3b BeaCard (deterministic dims summative-safe, LLM dims "
    "formative until EV-5). depth_rank ordering is an assumption (histogram published "
    "beside the slope). In-session deepening is NOT learning — efficacy needs a Tier-3 RCT."
)


def _tutor_quality(bundle: Optional[dict], tutor_moves: List[Dict]) -> dict:
    """Fold EV-3b's authored-scaffolding BeaCard + the live reveal_rate from telemetry."""
    bea = None
    if isinstance(bundle, dict) and bundle:
        try:
            from eval.validity.bea_tutor.bea import score_bundle
            rep = score_bundle(bundle)
            bea = {"n_moves": rep["n_moves"], "reveal_rate": rep["reveal_rate"],
                   "actionability_rate": rep["actionability_rate"],
                   "summative_safe_rate": rep["summative_safe_rate"]}
        except Exception:
            bea = None
    n = len(tutor_moves)
    live_reveal = sum(1 for e in tutor_moves if e.get("revealed") or e.get("reveal_blocked"))
    return {"authored_bea": bea, "live_reveal_rate": (live_reveal / n) if n else None}


def build_scorecard(events: List[Dict], bundle: Optional[dict]) -> dict:
    sigs = events_of_type(events, "reasoning_signal")
    moves = events_of_type(events, "tutor_move")
    traj = {"signal_histogram": signal_histogram(sigs), "depth_slope": depth_slope(sigs),
            "signal_entropy": signal_entropy(sigs), "target_coverage": target_coverage(sigs, bundle or {}),
            "n_signals": len(sigs)}
    cont = contingency(moves)
    tq = _tutor_quality(bundle, moves)
    verdict = {
        "anti_offloading_ok": cont["reveal_violations"] == 0,   # HARD VETO
        "eliciting_depth": bool(traj["depth_slope"] is not None and traj["depth_slope"] > 0),
        "contingent": bool(cont["rate"] is not None and cont["rate"] >= 0.8),
    }
    return {"trajectory": traj, "tutor_quality": tq, "contingency": cont,
            "verdict": verdict, "note": _NOTE}
