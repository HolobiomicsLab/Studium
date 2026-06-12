"""Tests for metrics.py — Brier, ROC-AUC, accuracy (pure Python)."""

import pytest

from eval.validity.kt_calibration.metrics import accuracy, auc, brier


def test_brier_perfect_predictions_is_zero():
    assert brier([1, 0, 1, 0], [1.0, 0.0, 1.0, 0.0]) == pytest.approx(0.0)


def test_brier_known_vector():
    # mean((p - y)^2): (0.8-1)^2=0.04 ; (0.3-0)^2=0.09 -> mean 0.065
    assert brier([1, 0], [0.8, 0.3]) == pytest.approx(0.065)


def test_brier_constant_half():
    # all p=0.5 -> each (0.25) -> mean 0.25
    assert brier([1, 0, 1, 0], [0.5, 0.5, 0.5, 0.5]) == pytest.approx(0.25)


def test_auc_perfect_separation_is_one():
    # positives strictly above negatives
    y = [0, 0, 1, 1]
    p = [0.1, 0.2, 0.8, 0.9]
    assert auc(y, p) == pytest.approx(1.0)


def test_auc_perfect_inversion_is_zero():
    y = [0, 0, 1, 1]
    p = [0.9, 0.8, 0.2, 0.1]
    assert auc(y, p) == pytest.approx(0.0)


def test_auc_all_one_class_returns_half():
    assert auc([1, 1, 1], [0.2, 0.6, 0.9]) == pytest.approx(0.5)
    assert auc([0, 0, 0], [0.2, 0.6, 0.9]) == pytest.approx(0.5)


def test_auc_ties_use_average_ranks():
    # one pos, one neg, identical scores -> AUC 0.5 (tie averaged)
    assert auc([0, 1], [0.5, 0.5]) == pytest.approx(0.5)


def test_auc_handles_partial_ties():
    # y=[0,1,1], p=[0.5,0.5,0.9]
    # ranks (ascending): 0.5,0.5 tie -> avg rank 1.5 each; 0.9 -> rank 3
    # sum_ranks_pos = 1.5 (the tied pos) + 3 = 4.5 ; n_pos=2 n_neg=1
    # auc = (4.5 - 2*3/2) / (2*1) = (4.5 - 3)/2 = 0.75
    assert auc([0, 1, 1], [0.5, 0.5, 0.9]) == pytest.approx(0.75)


def test_auc_random_is_near_half():
    import random

    rng = random.Random(0)
    n = 4000
    y = [rng.randint(0, 1) for _ in range(n)]
    p = [rng.random() for _ in range(n)]
    assert auc(y, p) == pytest.approx(0.5, abs=0.05)


def test_accuracy_threshold():
    # p>=0.5 -> predict 1
    y = [1, 0, 1, 0]
    p = [0.9, 0.1, 0.4, 0.6]  # preds: 1,0,0,1 -> correct on idx0,idx1 -> 0.5
    assert accuracy(y, p) == pytest.approx(0.5)


def test_accuracy_perfect():
    assert accuracy([1, 0], [0.7, 0.2]) == pytest.approx(1.0)
