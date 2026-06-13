# tests/test_contingency.py
from eval.validity.reasoning_depth.contingency import IDEAL_MOVE, contingency

def _tm(signal, move_kind, revealed=False, reveal_blocked=False, ti=0):
    return {"type": "tutor_move", "scene_id": "d1", "move_kind": move_kind,
            "in_reply_to_signal": signal, "revealed": revealed, "reveal_blocked": reveal_blocked, "turn_index": ti}

def test_ideal_move_table_matches_contingency_ts():
    assert IDEAL_MOVE == {"justification": "probe_justification", "hypothesis": "invite_test",
                          "question": "redirect_question", "counterexample": "acknowledge_extend",
                          "synthesis": "probe_synthesis"}

def test_contingency_rate_and_reveal_veto():
    evs = [_tm("hypothesis", "invite_test"),                 # contingent
           _tm("question", "redirect_question"),             # contingent
           _tm("synthesis", "scaffold_hint"),                # scaffold always allowed → contingent
           _tm("synthesis", "invite_test"),                  # wrong move → not contingent
           _tm("hypothesis", "invite_test", revealed=True)]  # revealed → veto + not contingent
    c = contingency(evs)
    assert c["n_moves"] == 5
    assert abs(c["rate"] - 3 / 5) < 1e-9
    assert c["reveal_violations"] == 1
    assert c["per_signal"]["hypothesis"]["n"] == 2

def test_contingency_empty():
    c = contingency([])
    assert c["n_moves"] == 0 and c["rate"] is None and c["reveal_violations"] == 0
