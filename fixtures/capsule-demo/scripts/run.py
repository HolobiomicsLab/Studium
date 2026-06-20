"""Light ASB-style capsule: fit a first-order decay rate from noisy data, emit a CSV + a figure.
Pure compute + matplotlib; writes outputs/stats.csv and figures/decay.png; prints a LANDMARK line."""
import csv
import os

import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless — render to file, no display server
import matplotlib.pyplot as plt

os.makedirs("outputs", exist_ok=True)
os.makedirs("figures", exist_ok=True)

rng = np.random.default_rng(0)
t = np.linspace(0.0, 10.0, 50)
k_true = 0.7
y = np.exp(-k_true * t) + rng.normal(0.0, 0.02, t.size)

mask = y > 0  # log-linear fit on positive samples
k_fit = float(-np.polyfit(t[mask], np.log(y[mask]), 1)[0])
half_life = float(np.log(2) / k_fit)

with open("outputs/stats.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["metric", "value"])
    w.writerow(["k_fit", round(k_fit, 4)])
    w.writerow(["half_life", round(half_life, 4)])

plt.figure(figsize=(5, 3))
plt.scatter(t, y, s=12, label="data")
plt.plot(t, np.exp(-k_fit * t), "r-", label=f"fit k={k_fit:.3f}")
plt.xlabel("t"); plt.ylabel("signal"); plt.legend(); plt.tight_layout()
plt.savefig("figures/decay.png", dpi=110)

print(f"LANDMARK k_fit={k_fit:.4f} half_life={half_life:.4f}")
