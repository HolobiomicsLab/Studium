"""Light ASB-style capsule: fit a first-order decay rate from noisy data, emit a CSV + a figure.
Pure compute + matplotlib; writes outputs/stats.csv and figures/decay.png; prints a LANDMARK line.

UNITS (INT-STUDIUM-004): the time axis is in SECONDS, so k is in s^-1 and the half-life in s.
The axis used to be a bare `t` and the landmark bare numbers, which made a downstream judgment
scene unscorable: `fixtures/capsule-judgment-demo` plants the flaw "la demi-vie depasse une
heure" against this run, and 1.6457 of an unnamed unit neither confirms nor refutes it. A capsule
that reports a quantity reports the unit it measured it in.
"""
import csv
import os

import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless — render to file, no display server
import matplotlib.pyplot as plt

os.makedirs("outputs", exist_ok=True)
os.makedirs("figures", exist_ok=True)

rng = np.random.default_rng(0)
t = np.linspace(0.0, 10.0, 50)  # seconds
k_true = 0.7                    # s^-1
y = np.exp(-k_true * t) + rng.normal(0.0, 0.02, t.size)

mask = y > 0  # log-linear fit on positive samples
k_fit = float(-np.polyfit(t[mask], np.log(y[mask]), 1)[0])
half_life = float(np.log(2) / k_fit)

with open("outputs/stats.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["metric", "value", "unit"])
    w.writerow(["k_fit", round(k_fit, 4), "s^-1"])
    w.writerow(["half_life", round(half_life, 4), "s"])

plt.figure(figsize=(5, 3))
plt.scatter(t, y, s=12, label="data")
plt.plot(t, np.exp(-k_fit * t), "r-", label=f"fit k={k_fit:.3f} 1/s")
plt.xlabel("t (s)"); plt.ylabel("signal"); plt.legend(); plt.tight_layout()
plt.savefig("figures/decay.png", dpi=110)

print(f"LANDMARK k_fit={k_fit:.4f} s^-1 half_life={half_life:.4f} s")
