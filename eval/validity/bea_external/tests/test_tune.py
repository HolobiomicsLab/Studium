# tests/test_tune.py
from eval.validity.bea_external.tune import split_by_qid, improve
from eval.validity.bea_external.loader import TeacherTurn

def _turn(text, move, qid):
    return TeacherTurn(text, move, move in {"probing", "focus"}, qid=qid)

def test_split_by_qid_has_no_leakage():
    turns = [_turn("a", "probing", "1"), _turn("b", "telling", "1"), _turn("c", "focus", "2")]
    train, test = split_by_qid(turns, test_frac=0.5, seed=0)
    train_q = {t.qid for t in train}; test_q = {t.qid for t in test}
    assert train_q.isdisjoint(test_q)               # a qid is wholly in train or test

def test_improve_reports_before_after_and_picks_a_candidate():
    # probing questions the baseline misses; generic that it correctly rejects
    turns = ([_turn(f"how much is item {i}?", "probing", str(i)) for i in range(10)]
             + [_turn(f"Exactly correct {i}!", "generic", str(100 + i)) for i in range(10)])
    rep = improve(turns, candidates=[(), ("how", "?")], test_frac=0.5, seed=1)
    assert rep["baseline"]["f1"] <= rep["improved"]["f1"]   # adding interrogatives helps
    assert rep["chosen_extra_terms"] == ["how", "?"]
    assert "note" in rep
