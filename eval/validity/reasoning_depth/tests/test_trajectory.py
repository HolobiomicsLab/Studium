# tests/test_trajectory.py
from eval.validity.reasoning_depth.trajectory import (
    DEPTH_RANK, signal_histogram, depth_slope, signal_entropy, target_coverage,
)

def _sig(signal, ti):
    return {"type": "reasoning_signal", "scene_id": "d1", "signal": signal, "confidence": 0.8, "turn_index": ti}

def test_depth_rank_ladder():
    assert DEPTH_RANK["question"] < DEPTH_RANK["justification"] < DEPTH_RANK["hypothesis"] < DEPTH_RANK["counterexample"] < DEPTH_RANK["synthesis"]

def test_histogram_and_entropy():
    evs = [_sig("question", 0), _sig("synthesis", 1)]
    h = signal_histogram(evs)
    assert h["question"] == 1 and h["synthesis"] == 1
    assert signal_entropy(evs) > 0.0          # two distinct signals → positive entropy

def test_depth_slope_positive_when_deepening():
    evs = [_sig("question", 0), _sig("justification", 1), _sig("synthesis", 2)]
    assert depth_slope(evs) > 0.0
    assert depth_slope([_sig("question", 0)]) is None   # need >=2 points

def test_target_coverage_against_bundle():
    bundle = {"scenes": [{"id": "d1", "type": "discussion", "target_signals": ["hypothesis", "synthesis"]}]}
    evs = [_sig("hypothesis", 0)]
    assert target_coverage(evs, bundle) == 0.5          # 1 of 2 targets elicited
    assert target_coverage(evs, {}) is None             # no bundle targets → None
