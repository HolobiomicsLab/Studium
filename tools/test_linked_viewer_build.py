"""Build-contract checks for the linked pedagogical viewer."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _write_review(directory: Path) -> None:
    """Write the smallest checked-draft shape accepted by the existing builder."""
    source_text = "Modified cosine uses precursor mass while similarity remains limited evidence."
    import hashlib

    (directory / "plan.json").write_text(json.dumps({"status": "draft", "validated_by": None, "scene_outlines": [{"id": "inspect-matching"}]}))
    (directory / "evidence.json").write_text(json.dumps({"sources": [{"evidence_id": "source:1", "source_doi": "10.1000/synthetic", "title": "Synthetic source", "text": source_text, "text_sha256": hashlib.sha256(source_text.encode()).hexdigest()}]}))
    (directory / "source_links.json").write_text(json.dumps({"source_links": [{"scene_id": "inspect-matching", "evidence_id": "source:1", "quote": "precursor mass"}]}))
    (directory / "viewers.json").write_text(json.dumps([{"id": "spectrum-comparison", "scene_id": "inspect-matching", "source_ids": ["source:1"], "goal": "Compare linked evidence."}]))


def test_builder_embeds_linked_network_and_generation_brief(tmp_path: Path) -> None:
    """The compatible build command emits one self-contained linked viewer."""
    review, output = tmp_path / "review", tmp_path / "viewer"
    review.mkdir()
    _write_review(review)
    context = {"schema": "studium/operator-context/v1", "scene": {"id": "inspect-matching", "title": "Inspect"}}
    context_path = tmp_path / "context.json"
    context_path.write_text(json.dumps(context))
    result_path = tmp_path / "result.json"
    result_path.write_text(json.dumps({"score": 0.6477, "matched_peaks": 7}))
    run = subprocess.run(
        ["node", str(ROOT / "examples/literature-experience/build-viewer.mjs"),
         str(ROOT / "fixtures/metabo-judgment-demo/spectra.json"),
         str(result_path), str(context_path), str(review), str(output)],
        capture_output=True, text=True,
    )
    assert run.returncode == 0, run.stderr
    html = (output / "index.html").read_text()
    provenance = json.loads((output / "viewer-provenance.json").read_text())
    assert "studium/linked-spectrum-network/v1" in html
    assert "prediction-before-reveal" in html
    assert "data-node-id" in html
    assert "candidate similarity is not compound identification" in html.lower()
    assert provenance["network_sha256"]
    assert provenance["generation_brief_id"] == "linked-spectrum-network"


def test_synthetic_network_keeps_original_pair_ids() -> None:
    """The expanded network links the two stable IDs from the pairwise example."""
    spectra = json.loads((ROOT / "fixtures/metabo-judgment-demo/spectra.json").read_text())
    network = json.loads((ROOT / "examples/literature-experience/linked-network.json").read_text())
    node_ids = {node["id"] for node in network["nodes"]}
    assert spectra["experimental"]["id"] in node_ids
    assert spectra["reference"]["id"] in node_ids
    assert {candidate["node_id"] for candidate in network["candidates"]} == node_ids
    assert "synthetic" in network["note"].lower()
