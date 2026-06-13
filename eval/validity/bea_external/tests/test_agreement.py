# tests/test_agreement.py
from eval.validity.bea_external.agreement import binary_scores, cohen_kappa

def test_binary_scores_prf_and_confusion():
    # gold, pred (True = guiding)
    gold = [True, True, False, False, True]
    pred = [True, False, False, True, True]
    s = binary_scores(gold, pred)
    assert s["tp"] == 2 and s["fp"] == 1 and s["fn"] == 1 and s["tn"] == 1
    assert abs(s["precision"] - 2 / 3) < 1e-9
    assert abs(s["recall"] - 2 / 3) < 1e-9
    assert abs(s["f1"] - 2 / 3) < 1e-9

def test_cohen_kappa_perfect_and_chance():
    assert abs(cohen_kappa([True, False, True], [True, False, True]) - 1.0) < 1e-9
    # all-same predictions vs balanced gold → kappa 0
    assert abs(cohen_kappa([True, False, True, False], [True, True, True, True])) < 1e-9
