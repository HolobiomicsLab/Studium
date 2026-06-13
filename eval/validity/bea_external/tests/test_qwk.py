# tests/test_qwk.py
from eval.validity.bea_external.agreement import quadratic_weighted_kappa as qwk

def test_qwk_perfect_and_disagree():
    cats = [0.0, 0.5, 1.0]
    assert abs(qwk([0.0, 0.5, 1.0], [0.0, 0.5, 1.0], cats) - 1.0) < 1e-9
    # systematic max disagreement → negative/low
    assert qwk([0.0, 0.0, 1.0, 1.0], [1.0, 1.0, 0.0, 0.0], cats) < 0.0

def test_qwk_partial_credit_beats_binary():
    cats = [0.0, 0.5, 1.0]
    # off-by-one (0.5 vs 1.0) is penalised less than off-by-two (0 vs 1)
    near = qwk([1.0, 1.0], [0.5, 0.5], cats)
    far = qwk([1.0, 1.0, 0.0], [0.0, 0.0, 1.0], cats)
    assert near > far
