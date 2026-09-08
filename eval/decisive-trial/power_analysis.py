"""Simulation + analytic power analysis for the decisive Studium classroom trial.

The trial (see PREREGISTRATION.md) is a within-subject crossover: each learner does the
operation->judgment loop under a TREATMENT arm (with the audit loop) and an ACTIVE CONTROL
arm (same capsule, no audit), and the primary endpoint is a *judgment-transfer* score on a
NOVEL flawed reading of a result the learner did not produce. The paired difference per
learner is the unit of analysis, so the effect size is Cohen's d_z (mean paired difference
/ SD of the paired differences).

This module answers two pre-registration questions with the standard normal approximation
to the paired test (exact under normal differences and large n; it slightly OVER-states
power at small n, so treat the returned n as a floor and add a few learners):

  - n_for_power(d)  -> learners needed for a target power at a given effect size;
  - mde_for_n(n)    -> the minimum detectable effect at a given class size.

A Monte-Carlo cross-check (`mc_power`) validates the analytic formula with no dependencies.
Stdlib only (no numpy/scipy): the normal CDF is `math.erf`; the quantile is Acklam's
rational approximation.
"""
from __future__ import annotations

import math
import random
import statistics

# Acklam's rational approximation to the inverse standard-normal CDF (|err| < 1.2e-9 central).
_A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
_B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
_C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]


def norm_cdf(x: float) -> float:
    """Standard-normal CDF via the error function."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def norm_ppf(p: float) -> float:
    """Standard-normal quantile (inverse CDF) for 0 < p < 1."""
    if not 0.0 < p < 1.0:
        raise ValueError("p must be in (0, 1)")
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)
    if p <= phigh:
        q = p - 0.5
        r = q * q
        return (((((_A[0] * r + _A[1]) * r + _A[2]) * r + _A[3]) * r + _A[4]) * r + _A[5]) * q / (((((_B[0] * r + _B[1]) * r + _B[2]) * r + _B[3]) * r + _B[4]) * r + 1)
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((_C[0] * q + _C[1]) * q + _C[2]) * q + _C[3]) * q + _C[4]) * q + _C[5]) / ((((_D[0] * q + _D[1]) * q + _D[2]) * q + _D[3]) * q + 1)


def power_paired(n: int, d: float, alpha: float = 0.05, sides: int = 2) -> float:
    """Power of a paired test at n learners for a paired effect size d (Cohen's d_z),
    by the normal approximation. Two-sided by default."""
    if n < 2:
        return 0.0
    z = norm_ppf(1 - alpha / sides)
    ncp = abs(d) * math.sqrt(n)
    return norm_cdf(ncp - z) + norm_cdf(-ncp - z)


def n_for_power(d: float, power: float = 0.80, alpha: float = 0.05, sides: int = 2, n_max: int = 5000) -> int | None:
    """Smallest learner count reaching the target power for effect size d, or None if > n_max."""
    for n in range(2, n_max + 1):
        if power_paired(n, d, alpha, sides) >= power:
            return n
    return None


def mde_for_n(n: int, power: float = 0.80, alpha: float = 0.05, sides: int = 2) -> float:
    """Minimum detectable effect (Cohen's d_z) at n learners for the target power, via bisection."""
    lo, hi = 0.0, 3.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if power_paired(n, mid, alpha, sides) < power:
            lo = mid
        else:
            hi = mid
    return round(hi, 4)


def mc_power(n: int, d: float, alpha: float = 0.05, sides: int = 2, sims: int = 20000, seed: int = 7) -> float:
    """Monte-Carlo estimate of the same power, to cross-check the analytic formula. Draws paired
    differences ~ Normal(d, 1) (so d is in SD-of-difference units) and applies the z-based test."""
    rng = random.Random(seed)
    z = norm_ppf(1 - alpha / sides)
    rejections = 0
    for _ in range(sims):
        diffs = [rng.gauss(d, 1.0) for _ in range(n)]
        sd = statistics.stdev(diffs) or 1e-9
        stat = statistics.mean(diffs) / (sd / math.sqrt(n))
        if abs(stat) > z:
            rejections += 1
    return rejections / sims


def _print_report() -> None:
    print("Decisive-trial power analysis (paired within-subject crossover; primary endpoint = judgment transfer)\n")
    print("Learners needed (two-sided alpha=0.05):")
    print(f"  {'effect d_z':>10} | {'80% power':>9} | {'90% power':>9}")
    for d in (0.3, 0.5, 0.8):
        print(f"  {d:>10.2f} | {str(n_for_power(d, 0.80)):>9} | {str(n_for_power(d, 0.90)):>9}")
    print("\nMinimum detectable effect (d_z) at realistic L1/graduate class sizes (80% power):")
    print(f"  {'n learners':>10} | {'MDE d_z':>8}")
    for n in (30, 45, 60, 90, 120):
        print(f"  {n:>10} | {mde_for_n(n, 0.80):>8.2f}")
    n0, d0 = 45, 0.5
    print(f"\nMonte-Carlo cross-check at n={n0}, d={d0}: analytic={power_paired(n0, d0):.3f}  MC={mc_power(n0, d0, sims=20000):.3f}")


if __name__ == "__main__":
    # Smoke check: monotone in n and d, MC agrees with the analytic formula.
    assert power_paired(60, 0.5) > power_paired(30, 0.5), "power should rise with n"
    assert power_paired(60, 0.8) > power_paired(60, 0.3), "power should rise with effect size"
    assert abs(mc_power(45, 0.5, sims=20000) - power_paired(45, 0.5)) < 0.03, "MC should match analytic"
    _print_report()
