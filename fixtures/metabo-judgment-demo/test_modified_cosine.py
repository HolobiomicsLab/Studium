"""Tests for the flagship metabolomics reproduction (deterministic modified cosine)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from run import modified_cosine  # noqa: E402


def _spectra():
    with open(os.path.join(HERE, "spectra.json")) as handle:
        return json.load(handle)


def test_landmark_is_deterministic_and_analogue_level():
    data = _spectra()
    r = modified_cosine(data["experimental"], data["reference"], data["fragment_tol_da"])
    assert r == {"score": 0.6477, "matched_peaks": 7}   # the landmark the judgment scene grounds on
    assert 0.0 <= r["score"] <= 1.0
    # analogue-level, NOT an identity match — this is why "confirmed MSI-1" is the planted flaw
    assert 0.5 < r["score"] < 0.85


def test_identical_spectra_score_one():
    data = _spectra()
    exp = data["experimental"]
    r = modified_cosine(exp, exp, data["fragment_tol_da"])
    assert abs(r["score"] - 1.0) < 1e-9


def test_mass_shift_matching_recovers_shifted_fragments():
    # Two peaks that only align after the precursor shift must still match.
    exp = {"precursor_mz": 300.0, "peaks": [[100.0, 1.0], [200.0, 1.0]]}
    ref = {"precursor_mz": 286.0, "peaks": [[100.0, 1.0], [186.0, 1.0]]}  # 200 - 14 = 186
    r = modified_cosine(exp, ref, 0.02)
    assert r["matched_peaks"] == 2 and abs(r["score"] - 1.0) < 1e-9


def test_no_shared_peaks_scores_zero():
    exp = {"precursor_mz": 300.0, "peaks": [[111.0, 1.0]]}
    ref = {"precursor_mz": 300.0, "peaks": [[999.0, 1.0]]}
    assert modified_cosine(exp, ref, 0.02)["matched_peaks"] == 0


def test_judgment_scene_is_grounded_on_the_landmark():
    with open(os.path.join(HERE, "judgment.json")) as handle:
        scene = json.load(handle)
    assert scene["type"] == "spot_the_flaw" and scene["verdict_deck"] is True
    assert "0.6477" in scene["reference_result"]["landmark"]  # grounded on the run's real number
    assert len(scene["claims"]) == 3 and len(scene["sound_claims"]) == 2  # flawed + sound for the deck


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
