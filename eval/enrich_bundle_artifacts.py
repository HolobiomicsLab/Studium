#!/usr/bin/env python3
"""enrich_bundle_artifacts.py — attach real renderable artifacts to an authored FBMN bundle.

Takes a course bundle (zip with lesson.json) and produces an enriched lesson.json carrying the
three live-artifact kinds the webview pane renders, so the artifact pane shows real content end to
end against the actual course:

  * equation_latex  → the spectral cosine-similarity formula (edge weight) on the Introduction concept;
  * plot_spec       → a Vega-Lite bar chart of a feature's MS1 peak area across samples
                      (relative quantification) on the "Two Inputs" concept;
  * executed_result → a new `reproduction` scene whose capsule is actually RUN (tools/capsule_runner.py
                      via eval/harness/repro_enrich.py), attaching the rendered figure + graded checks.

Output is written as <out>.json (the bundle-resolver loads .json directly — no re-zip needed).

  .venv/bin/python eval/enrich_bundle_artifacts.py /tmp/studium_live/11-bundle.zip /tmp/studium_live/11-enriched.json
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness.repro_enrich import enrich_reproduction  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

COSINE_LATEX = (
    r"\operatorname{cos}(A,B)=\dfrac{\sum_i I^{A}_i\,I^{B}_i}"
    r"{\sqrt{\sum_i (I^{A}_i)^2}\;\sqrt{\sum_i (I^{B}_i)^2}}"
)

PEAKS_VEGA = {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "description": "MS1 peak area of feature 142 across samples (relative quantification).",
    "data": {"values": [
        {"sample": "ctrl 1", "area": 3.1, "group": "control"},
        {"sample": "ctrl 2", "area": 2.8, "group": "control"},
        {"sample": "ctrl 3", "area": 3.4, "group": "control"},
        {"sample": "treat 1", "area": 8.2, "group": "treatment"},
        {"sample": "treat 2", "area": 7.9, "group": "treatment"},
        {"sample": "treat 3", "area": 8.6, "group": "treatment"},
    ]},
    "mark": "bar",
    "encoding": {
        "x": {"field": "sample", "type": "nominal", "title": "sample"},
        "y": {"field": "area", "type": "quantitative", "title": "MS1 peak area (×10^6)"},
        "color": {"field": "group", "type": "nominal",
                  "scale": {"domain": ["control", "treatment"], "range": ["#85B7EB", "#1D9E75"]}},
    },
}


def _evidence(abs_asset: dict) -> dict:
    return {
        "abs_asset": abs_asset,
        "enrichment_metadata": {
            "enricher_version": "artifact-enrich-0.1",
            "perspicacite_mode_used": "basic",
            "timestamp": "2026-06-16T00:00:00Z",
            "degraded": False,
        },
    }


def _repro_scene_base() -> dict:
    return {
        "id": "s-repro-quant", "type": "reproduction",
        "title": "Reproduce: fit a degradation rate from feature intensities",
        "objective_refs": [], "concept_refs": ["c-11-the-two-inputs-fbmn-requ-1"],
        "estimated_seconds": 600, "adaptation_hooks": [],
        "task_card_id": "fbmn-decay-demo",
        "steps": [{
            "step_id": "s1",
            "instruction": "Fit a first-order decay to the feature's intensity time-course and report k and the half-life.",
            "expected_input_schema": {}, "expected_output": "outputs/stats.csv with k_fit",
        }],
    }


def main(argv: list[str]) -> int:
    src = Path(argv[0]).resolve() if argv else REPO / ".." / "11-bundle.zip"
    out = Path(argv[1]).resolve() if len(argv) > 1 else Path("/tmp/studium_live/11-enriched.json")

    bundle = json.loads(zipfile.ZipFile(src).read("lesson.json"))
    scenes = {s["id"]: s for s in bundle["scenes"]}

    # 1) equation_latex on the Introduction concept (the edge-weight formula)
    scenes["s-concept-c-11-introduction-0"]["evidence"] = _evidence({
        "asset_type": "equation_latex", "payload_inline": COSINE_LATEX,
        "prov_derived_from": "doi:10.1038/s41592-020-0933-6",
    })

    # 2) plot_spec on the Two-Inputs concept (relative quantification across samples)
    scenes["s-concept-c-11-the-two-inputs-fbmn-requ-1"]["evidence"] = _evidence({
        "asset_type": "plot_spec", "payload_inline": json.dumps(PEAKS_VEGA),
        "prov_derived_from": "doi:10.1038/s41592-020-0933-6",
    })

    # 3) a real executed reproduction scene (run the demo capsule → figure + graded checks)
    repro, res = enrich_reproduction(_repro_scene_base(), REPO / "fixtures" / "capsule-demo", "/tmp/repro_enrich_out")
    print(f"[capsule] status={res.get('status')} passed={res.get('passed')} landmark={res.get('landmark')}", file=sys.stderr)

    # insert the reproduction scene just before the ai_critique scene
    new_scenes = []
    for s in bundle["scenes"]:
        if s["id"] == "s-critique":
            new_scenes.append(repro)
        new_scenes.append(s)
    bundle["scenes"] = new_scenes

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    print(f"BUNDLE: {out}  (scenes={len(bundle['scenes'])})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
