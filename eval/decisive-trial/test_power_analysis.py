"""Tests for the decisive-trial power analysis (stdlib only)."""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from power_analysis import (  # noqa: E402
    norm_cdf, norm_ppf, power_paired, n_for_power, mde_for_n, mc_power,
)


def test_norm_primitives_match_known_values():
    assert abs(norm_cdf(0.0) - 0.5) < 1e-9
    assert abs(norm_ppf(0.975) - 1.959964) < 1e-4
    assert abs(norm_ppf(0.025) + 1.959964) < 1e-4
    # round-trip
    assert abs(norm_cdf(norm_ppf(0.83)) - 0.83) < 1e-6


def test_power_is_monotone_in_n_and_effect():
    assert power_paired(30, 0.5) < power_paired(60, 0.5) < power_paired(120, 0.5)
    assert power_paired(60, 0.3) < power_paired(60, 0.5) < power_paired(60, 0.8)
    assert 0.0 <= power_paired(60, 0.5) <= 1.0


def test_n_for_power_medium_effect_is_in_the_textbook_range():
    # paired d_z = 0.5, 80% power, two-sided alpha=0.05 -> ~34 by the normal approximation
    n = n_for_power(0.5, 0.80)
    assert n is not None and 28 <= n <= 40


def test_mde_shrinks_as_class_grows():
    assert mde_for_n(120, 0.80) < mde_for_n(30, 0.80)
    # a realistic L1 class (~60) can detect a medium effect
    assert mde_for_n(60, 0.80) < 0.55


def test_monte_carlo_agrees_with_analytic():
    for n, d in [(30, 0.5), (60, 0.5), (60, 0.8)]:
        assert abs(mc_power(n, d, sims=20000) - power_paired(n, d)) < 0.03


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
