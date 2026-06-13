# tests/test_scorecard.py
from eval.validity.reasoning_depth.scorecard import build_scorecard

def _sig(s, ti): return {"type": "reasoning_signal", "scene_id": "d1", "signal": s, "confidence": 0.8, "turn_index": ti}
def _tm(s, mk, rb=False, ti=0): return {"type": "tutor_move", "scene_id": "d1", "move_kind": mk, "in_reply_to_signal": s, "revealed": False, "reveal_blocked": rb, "turn_index": ti}

def test_scorecard_three_axes_and_verdict_ok():
    events = [_sig("question", 0), _sig("hypothesis", 1), _sig("synthesis", 2),
              _tm("question", "redirect_question"), _tm("hypothesis", "invite_test")]
    bundle = {"scenes": [{"id": "d1", "type": "discussion", "target_signals": ["hypothesis", "synthesis"]}]}
    card = build_scorecard(events, bundle)
    assert set(card.keys()) >= {"trajectory", "tutor_quality", "contingency", "verdict", "note"}
    assert card["trajectory"]["depth_slope"] > 0
    assert card["contingency"]["reveal_violations"] == 0
    assert card["verdict"]["anti_offloading_ok"] is True       # no reveal violations

def test_reveal_violation_is_a_hard_veto():
    events = [_sig("hypothesis", 0), _tm("hypothesis", "invite_test", rb=True)]
    card = build_scorecard(events, {})
    assert card["contingency"]["reveal_violations"] == 1
    assert card["verdict"]["anti_offloading_ok"] is False       # veto
