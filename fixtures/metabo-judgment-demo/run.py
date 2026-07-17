"""Flagship concept->reproduce->judge capsule (metabolomics), deterministic core.

Reproduces the real GNPS-style *modified cosine* between an experimental MS/MS spectrum and a
library reference, allowing a precursor mass shift so a near-analogue still matches. This is the
authentic operation a scientist runs when annotating an untargeted LC-MS/MS feature; the score it
produces is exactly the kind of number an AI reading routinely OVER-interprets as a confirmed
identification, which is what the paired judgment scene (judgment.json) asks the learner to audit.

Run: `python run.py` (writes outputs/match.json, prints the landmark). Stdlib only.

Full flagship (weeks, needs data): swap spectra.json for a real redistributable GNPS/MassIVE FBMN
spectrum pair and add the SIRIUS/CANOPUS formula+class step; the judgment target is unchanged.
"""
from __future__ import annotations

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def _normalize(peaks: list[list[float]]) -> list[tuple[float, float]]:
    """Return (m/z, intensity) with the intensity vector scaled to unit L2 norm."""
    norm = math.sqrt(sum(i * i for _, i in peaks)) or 1.0
    return [(mz, i / norm) for mz, i in peaks]


def modified_cosine(exp: dict, ref: dict, tol: float) -> dict:
    """GNPS-style modified cosine: greedy one-to-one peak matching where a peak matches directly
    (|Δm/z| ≤ tol) OR after the precursor mass shift (|Δm/z − Δprecursor| ≤ tol); score is the sum
    of matched normalized-intensity products. Deterministic. Returns {score, matched_peaks}."""
    a = _normalize(exp["peaks"])
    b = _normalize(ref["peaks"])
    shift = exp["precursor_mz"] - ref["precursor_mz"]
    candidates = []
    for i, (mz_a, int_a) in enumerate(a):
        for j, (mz_b, int_b) in enumerate(b):
            if abs(mz_a - mz_b) <= tol or abs((mz_a - mz_b) - shift) <= tol:
                candidates.append((int_a * int_b, i, j))
    candidates.sort(reverse=True)  # greedy: largest intensity-product matches first
    used_a: set[int] = set()
    used_b: set[int] = set()
    score = 0.0
    matched = 0
    for product, i, j in candidates:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        score += product
        matched += 1
    return {"score": round(min(1.0, score), 4), "matched_peaks": matched}


def main() -> None:
    with open(os.path.join(HERE, "spectra.json")) as handle:
        data = json.load(handle)
    result = modified_cosine(data["experimental"], data["reference"], data["fragment_tol_da"])
    out_dir = os.path.join(HERE, "outputs")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "match.json"), "w") as handle:
        json.dump(result, handle, indent=2)
    # The landmark: the number an AI reading will over-interpret. Withheld from the learner by the
    # run protocol; produced fresh by the learner's own run.
    print(f"MODIFIED_COSINE={result['score']} MATCHED_PEAKS={result['matched_peaks']}")


if __name__ == "__main__":
    main()
