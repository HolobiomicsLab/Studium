"""Reject impossible measurements before constructing a convincing viewer."""
import copy
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("mutation", ["negative_matches", "too_many_matches", "zero_tolerance",
                                       "negative_precursor", "zero_signal"])
def test_viewer_rejects_impossible_measurements_before_reading_review(tmp_path, mutation):
    spectra = copy.deepcopy(json.loads((ROOT / "fixtures/metabo-judgment-demo/spectra.json").read_text()))
    result = {"score": 0.5, "matched_peaks": 1}
    if mutation == "negative_matches":
        result["matched_peaks"] = -1
    elif mutation == "too_many_matches":
        result["matched_peaks"] = 1000
    elif mutation == "zero_tolerance":
        spectra["fragment_tol_da"] = 0
    elif mutation == "negative_precursor":
        spectra["experimental"]["precursor_mz"] = -100
    else:
        spectra["experimental"]["peaks"] = [[100, 0], [101, 0]]
    for name, data in [("spectra.json", spectra), ("result.json", result), ("context.json", {})]:
        (tmp_path / name).write_text(json.dumps(data))
    run = subprocess.run(["node", str(ROOT / "examples/literature-experience/build-viewer.mjs"),
                          str(tmp_path / "spectra.json"), str(tmp_path / "result.json"),
                          str(tmp_path / "context.json"), str(tmp_path / "absent-review"), str(tmp_path / "viewer")],
                         capture_output=True, text=True)
    assert run.returncode != 0
    assert any(message in run.stderr for message in ["Invalid spectrum", "Invalid measurement"])
    assert not (tmp_path / "viewer").exists()
