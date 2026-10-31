"""Independent numerical checks for the synthetic linked-spectrum viewer."""
from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "examples/literature-experience/linked-viewer-core.mjs"
NETWORK = ROOT / "examples/literature-experience/linked-network.json"


def _run_core(expression: str) -> object:
    """Evaluate one public core operation and return its JSON value."""
    script = f"import * as core from {json.dumps(CORE.as_uri())}; console.log(JSON.stringify({expression}));"
    run = subprocess.run(["node", "--input-type=module", "--eval", script], capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def _oracle_score(first: dict, second: dict, tolerance: float) -> float:
    """Calculate modified cosine independently from the JavaScript implementation."""
    first_norm = math.sqrt(sum(intensity**2 for _, intensity in first["peaks"]))
    second_norm = math.sqrt(sum(intensity**2 for _, intensity in second["peaks"]))
    shift = first["precursor_mz"] - second["precursor_mz"]
    candidates = []
    for first_index, (first_mz, first_intensity) in enumerate(first["peaks"]):
        for second_index, (second_mz, second_intensity) in enumerate(second["peaks"]):
            is_direct = abs(first_mz - second_mz) <= tolerance
            is_shifted = abs((first_mz - second_mz) - shift) <= tolerance
            if is_direct or is_shifted:
                product = first_intensity * second_intensity / first_norm / second_norm
                candidates.append((-product, first_index, second_index))
    used_first, used_second, score = set(), set(), 0.0
    for negative_product, first_index, second_index in sorted(candidates):
        if first_index in used_first or second_index in used_second:
            continue
        used_first.add(first_index)
        used_second.add(second_index)
        score -= negative_product
    return min(1.0, score)


def test_network_scores_match_independent_oracle() -> None:
    """Every displayed similarity agrees with a separate Python calculation."""
    network = json.loads(NETWORK.read_text())
    result = _run_core(f"core.calculateNetwork({json.dumps(network)})")
    by_id = {node["id"]: node for node in network["nodes"]}
    for edge in result["all_edges"]:
        expected = _oracle_score(by_id[edge["source"]], by_id[edge["target"]], network["fragment_tol_da"])
        assert edge["score"] == pytest.approx(expected, abs=1e-12)


def test_threshold_is_inclusive_and_preserves_nodes() -> None:
    """A boundary removes only edges and never changes stable node membership."""
    network = json.loads(NETWORK.read_text())
    baseline = _run_core(f"core.calculateNetwork({json.dumps(network)})")
    boundary_edge = next(edge for edge in baseline["all_edges"] if edge["score"] < 1)
    boundary = boundary_edge["score"]
    at_boundary = _run_core(f"core.calculateNetwork({json.dumps(network)}, {boundary})")
    above_boundary = _run_core(f"core.calculateNetwork({json.dumps(network)}, {boundary + 1e-9})")
    assert baseline["node_ids"] == at_boundary["node_ids"] == above_boundary["node_ids"]
    assert boundary_edge["id"] in {edge["id"] for edge in at_boundary["visible_edges"]}
    assert boundary_edge["id"] not in {edge["id"] for edge in above_boundary["visible_edges"]}


def test_ties_are_deterministic() -> None:
    """Equal candidate products use stable lowest-index peak pairs."""
    first = {"id": "a", "precursor_mz": 200, "peaks": [[100, 1], [100.01, 1]]}
    second = {"id": "b", "precursor_mz": 200, "peaks": [[100.005, 1]]}
    result = _run_core(f"core.modifiedCosine({json.dumps(first)}, {json.dumps(second)}, 0.02)")
    assert result["pairs"] == [{"first_index": 0, "second_index": 0, "kind": "direct", "contribution": 0.7071067811865475}]


@pytest.mark.parametrize(
    "mutation",
    [
        "network.nodes[0].peaks=[[100,0]]",
        "network.nodes[0].peaks=[[100,-1]]",
        "network.nodes[1].id=network.nodes[0].id",
        "network.candidates[0].node_id='absent'",
        "network.baseline_threshold=1.1",
    ],
)
def test_invalid_network_data_is_rejected(mutation: str) -> None:
    """Zero signal, invalid peaks, IDs and thresholds fail before rendering."""
    expression = (
        f"(()=>{{const network={NETWORK.read_text()};{mutation};"
        "try{return core.calculateNetwork(network)}catch(error){return {error:error.message}}})()"
    )
    result = _run_core(expression)
    assert "error" in result
