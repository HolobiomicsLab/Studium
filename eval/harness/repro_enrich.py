#!/usr/bin/env python3
"""repro_enrich.py — enrich a `reproduction` scene with a capsule's executed REFERENCE run.

This replaces the no-op reproduction path (ackGrader): given a reproduction scene that
references an ASB capsule, run the capsule once (tools/capsule_runner.py) at author time and
attach the rendered figure (`image_path`) + a graded `reference_result` to the scene, with
provenance. A heavy/deferred or type-checked-only capsule leaves the scene as step-text (honest),
so a Mode-B course ships real executed artifacts wherever the capsule is actually runnable.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]  # prototype-build/ (eval/harness/repro_enrich.py)
sys.path.insert(0, str(REPO / "tools"))
from capsule_runner import run_capsule  # noqa: E402


def enrich_reproduction(scene: dict, capsule_dir, out_dir=None) -> tuple[dict, dict]:
    """Run the capsule and, if it ran, attach image_path + reference_result to the scene."""
    res = run_capsule(capsule_dir, out_dir)
    if res.get("status") == "ran":
        sa = res.get("scene_assets") or {}
        if sa.get("image_path"):
            scene["image_path"] = sa["image_path"]
        scene["reference_result"] = {
            "ran": True,
            "passed": bool(res.get("passed")),
            "landmark": res.get("landmark"),
            "figure_path": sa.get("image_path"),
            "checks": res.get("checks") or [],
            "provenance": {
                "capsule_doi": res.get("doi"),
                "cmd": (res.get("provenance") or {}).get("cmd", []),
                "env": "isolated uv venv (python 3.13)",
            },
        }
    return scene, res


def _demo_scene() -> dict:
    return {
        "id": "s-repro-demo", "type": "reproduction",
        "title": "Reproduce: estimate a first-order rate constant",
        "objective_refs": [], "concept_refs": ["c-kinetics"],
        "estimated_seconds": 600, "adaptation_hooks": [],
        "task_card_id": "demo-decay-fit",
        "steps": [{
            "step_id": "s1",
            "instruction": "Fit a first-order decay and report k and the half-life.",
            "expected_input_schema": {}, "expected_output": "outputs/stats.csv with k_fit",
        }],
    }


if __name__ == "__main__":
    capsule = sys.argv[1] if len(sys.argv) > 1 else str(REPO / "fixtures" / "capsule-demo")
    scene, res = enrich_reproduction(_demo_scene(), capsule, "/tmp/repro_enrich_out")
    Path("/tmp/enriched_scene.json").write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print(json.dumps(scene, indent=2))
    print(f"\n[capsule status] {res.get('status')} (passed={res.get('passed')})", file=sys.stderr)
