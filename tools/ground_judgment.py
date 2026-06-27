#!/usr/bin/env python3
"""ground_judgment.py — attach a REAL capsule execution to a JUDGMENT scene.

The capsule-backed-lesson vehicle: real scientific operation grounds a judgment scene, but
the *judgment* (not the procedure) is what gets assessed. tools/capsule_runner.py runs the
capsule once at author time; this attaches its graded result to a ``spot_the_flaw`` scene as a
typed ``reference_result`` so the learner audits the AI's flawed reading AGAINST the genuine
output (figure + landmark + graded checks).

Mirrors eval/harness/repro_enrich.py (same projection, for the ``reproduction`` scene), but for
the judgment scene. The attached run carries NO answer key — the planted flaws live in
``scene['claims']`` — so surfacing the real result is the EVIDENCE the learner reasons from,
not a leak. The flawed *interpretation* is the LLM's; the *result* is verified data attached
here by code, which is what keeps the grounding honest (the LLM cannot fabricate the landmark).
"""

from __future__ import annotations


def reference_result_from_capsule(res: dict) -> dict:
    """Project a tools/capsule_runner.run_capsule() result into a schema ReferenceRun dict
    (the shape ReferenceRunSchema / ReferenceRun validate; shared with enrich_reproduction)."""
    sa = res.get("scene_assets") or {}
    return {
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


def ground_spot_the_flaw(scene: dict, capsule_result: dict) -> dict:
    """Attach a real capsule run to a spot_the_flaw scene (mutates + returns it).

    Sets ``reference_result`` (the typed grounding). sceneRenderAssets() DERIVES the
    ``executed_result`` render-asset from it client-side, so we deliberately do NOT also push an
    explicit render_asset here (that would double the figure in the manifest). A capsule whose
    status is not ``ran`` leaves the scene ungrounded — honest, exactly like enrich_reproduction.
    """
    if capsule_result.get("status") != "ran":
        return scene
    scene["reference_result"] = reference_result_from_capsule(capsule_result)
    return scene
