# tests/test_sample.py
from eval.validity.bea_external.sample import stratified_sample
from eval.validity.bea_external.loader import TeacherTurn

def _turn(move, i):
    return TeacherTurn(f"{move}-{i}", move, move in {"probing", "focus"}, qid=str(i))

def test_stratified_balances_moves_and_is_deterministic():
    turns = ([_turn("probing", i) for i in range(20)] + [_turn("telling", i) for i in range(20)]
             + [_turn("focus", i) for i in range(20)] + [_turn("generic", i) for i in range(5)])
    s1 = stratified_sample(turns, n_per_move=5, seed=0)
    s2 = stratified_sample(turns, n_per_move=5, seed=0)
    assert [t.text for t in s1] == [t.text for t in s2]      # deterministic
    from collections import Counter
    c = Counter(t.move for t in s1)
    assert c["probing"] == 5 and c["telling"] == 5 and c["focus"] == 5
    assert c["generic"] == 5                                  # only 5 available, take all
