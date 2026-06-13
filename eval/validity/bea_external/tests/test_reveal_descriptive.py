# tests/test_reveal_descriptive.py
from eval.validity.bea_external.run_bea_external import reveal_rate_by_move
from eval.validity.bea_external.loader import TeacherTurn

def test_reveal_rate_by_move_is_descriptive():
    # banned token must be >=3 chars to be caught by the shipped reveal_rule
    # (the 2-char "54" in the plan draft falls below tokenize()/substring thresholds).
    turns = [TeacherTurn("the answer is 7200", "telling", False, banned=["7200"]),
             TeacherTurn("how much is it?", "probing", True, banned=["7200"])]
    rates = reveal_rate_by_move(turns)
    assert rates["telling"]["n"] == 1 and rates["telling"]["reveal_rate"] == 1.0
    assert rates["probing"]["reveal_rate"] == 0.0
