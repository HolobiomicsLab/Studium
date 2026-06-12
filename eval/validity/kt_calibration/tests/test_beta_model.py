"""Tests for beta_model.BetaModel — must mirror beta-updater.ts EXACTLY.

Production formula (packages/adaptation-engine/src/beta-updater.ts):
  correct: alpha += ((1 - w) + 1) / (1 + hint_count)   == (2 - w) / (1 + hints)
  wrong:   beta  += w + 1
  predict  P(correct) = alpha / (alpha + beta)
Init state per (student, skill): (alpha, beta) = (1.0, 1.0).
"""

import math

import pytest

from eval.validity.kt_calibration.beta_model import BetaModel


def test_initial_prediction_is_one_half():
    m = BetaModel()
    # init (1,1) -> 1/(1+1) = 0.5, BEFORE any observation
    assert m.predict("s1", "k1") == pytest.approx(0.5)


def test_correct_update_hand_computed():
    # start (1,1); correct w=0.5 hints=0 -> alpha += (2-0.5)/(1+0) = 1.5 -> alpha=2.5
    m = BetaModel()
    m.update("s1", "k1", correct=1, w=0.5, hints=0)
    a, b = m.state("s1", "k1")
    assert a == pytest.approx(2.5)
    assert b == pytest.approx(1.0)
    # predict = 2.5 / (2.5 + 1.0) = 0.714285...
    assert m.predict("s1", "k1") == pytest.approx(2.5 / 3.5)


def test_wrong_update_hand_computed():
    # start (1,1); wrong w=0.5 -> beta += 0.5 + 1 = 1.5 -> beta=2.5
    m = BetaModel()
    m.update("s1", "k1", correct=0, w=0.5, hints=0)
    a, b = m.state("s1", "k1")
    assert a == pytest.approx(1.0)
    assert b == pytest.approx(2.5)
    assert m.predict("s1", "k1") == pytest.approx(1.0 / 3.5)


def test_hint_count_discounts_correct_gain():
    # correct w=0.0 hints=1 -> alpha += (2-0)/(1+1) = 1.0
    m = BetaModel()
    m.update("s1", "k1", correct=1, w=0.0, hints=1)
    a, b = m.state("s1", "k1")
    assert a == pytest.approx(2.0)
    assert b == pytest.approx(1.0)


def test_difficulty_extremes_correct():
    # w=0 correct -> alpha += 2.0 ; w=1 correct -> alpha += 1.0
    m = BetaModel()
    m.update("a", "k", correct=1, w=0.0, hints=0)
    assert m.state("a", "k")[0] == pytest.approx(3.0)  # 1 + 2.0
    m2 = BetaModel()
    m2.update("a", "k", correct=1, w=1.0, hints=0)
    assert m2.state("a", "k")[0] == pytest.approx(2.0)  # 1 + 1.0


def test_difficulty_extremes_wrong():
    # w=0 wrong -> beta += 1.0 ; w=1 wrong -> beta += 2.0
    m = BetaModel()
    m.update("a", "k", correct=0, w=0.0, hints=0)
    assert m.state("a", "k")[1] == pytest.approx(2.0)
    m2 = BetaModel()
    m2.update("a", "k", correct=0, w=1.0, hints=0)
    assert m2.state("a", "k")[1] == pytest.approx(3.0)


def test_states_are_independent_per_student_skill():
    m = BetaModel()
    m.update("s1", "k1", correct=1, w=0.5, hints=0)
    # untouched (s2,k1) and (s1,k2) still at init
    assert m.predict("s2", "k1") == pytest.approx(0.5)
    assert m.predict("s1", "k2") == pytest.approx(0.5)
    assert m.state("s2", "k1") == (1.0, 1.0)


def test_sequence_accumulates():
    m = BetaModel()
    m.update("s", "k", correct=1, w=0.5, hints=0)  # alpha 1->2.5
    m.update("s", "k", correct=0, w=0.5, hints=0)  # beta  1->2.5
    a, b = m.state("s", "k")
    assert a == pytest.approx(2.5)
    assert b == pytest.approx(2.5)
    assert m.predict("s", "k") == pytest.approx(0.5)


def test_predict_returns_finite_probability():
    m = BetaModel()
    for _ in range(50):
        m.update("s", "k", correct=1, w=0.3, hints=0)
    p = m.predict("s", "k")
    assert math.isfinite(p)
    assert 0.0 <= p <= 1.0
