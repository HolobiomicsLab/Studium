"""Tests for run_calibration.py — the calibration protocol.

Headline assertion (EV-4 sanity): on ground-truth synthetic data where learning
genuinely happens, the Beta learner model must BEAT the trivial RunningMean
floor on Brier (lower) AND AUC (higher).
"""

import math

from eval.validity.kt_calibration.run_calibration import evaluate_models
from eval.validity.kt_calibration.synth import generate_synthetic


def _all_finite(metrics):
    return all(math.isfinite(v) for v in metrics.values())


def test_all_models_run_and_produce_finite_metrics():
    data = generate_synthetic(n_students=30, n_skills=5, n_attempts=15, seed=1)
    results = evaluate_models(data)
    assert set(results.keys()) == {"beta", "bkt", "running_mean"}
    for name, metrics in results.items():
        assert {"brier", "auc", "accuracy", "n"} <= set(metrics.keys())
        assert _all_finite(metrics), f"{name} produced non-finite metrics"
        assert 0.0 <= metrics["brier"] <= 1.0
        assert 0.0 <= metrics["auc"] <= 1.0
        assert metrics["n"] == len(data)


def test_beta_beats_running_mean_on_synthetic():
    data = generate_synthetic(n_students=60, n_skills=6, n_attempts=20, seed=1)
    results = evaluate_models(data)
    beta = results["beta"]
    floor = results["running_mean"]
    assert beta["brier"] < floor["brier"], (
        f"Beta Brier {beta['brier']:.4f} should be below RunningMean "
        f"{floor['brier']:.4f}"
    )
    assert beta["auc"] > floor["auc"], (
        f"Beta AUC {beta['auc']:.4f} should exceed RunningMean "
        f"{floor['auc']:.4f}"
    )


def test_replay_predicts_before_updating():
    # A single interaction: the recorded prediction must be the PRIOR (0.5 for
    # Beta init), not influenced by the observed outcome.
    from eval.validity.kt_calibration.beta_model import BetaModel
    from eval.validity.kt_calibration.run_calibration import replay

    data = [{"student": "s", "skill": "k", "correct": 1, "order": 0}]
    ys, ps = replay(BetaModel(), data, difficulty={"k": 0.5})
    assert ys == [1]
    assert ps[0] == 0.5  # init prediction, before the correct answer moved alpha
