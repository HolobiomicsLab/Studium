#!/usr/bin/env python3
"""compose_lesson.py — the COMPOSITION CHAIN: (corpus + capsule) -> graded judgment bundle.

The gap analysis flagged that the PLANNER (``/plan``) and SCENE-SYNTH (``/scenes/synthesize``)
are two disjoint services nothing chains, and that the planner couldn't even request a
capsule-grounded judgment scene. This module is that missing chain, in-process:

  1. PLAN     — run the PlannerAgent on a corpus manifest (``emit_judgment_scenes`` on, so a
                spot_the_flaw outline is emitted per readable capsule).
  2. GROUND   — for each requested judgment capsule, guarantee a spot_the_flaw outline + an
                ``abs_capsule`` corpus_ref the orchestrator can resolve (covers capsules the
                planner's ABS reader can't introspect, e.g. flat single-card capsules).
  3. SYNTH    — run the SceneSynthOrchestrator with ``capsule_runner`` injected: it executes
                the real capsule once and attaches the verified ``reference_result`` to the
                judgment scene (code-attached, non-hallucinable) before bundling.

"Real scientific operation = the vehicle; calibrated judgment of a real artifact = the
destination." The flawed READING is the LLM's; the RESULT is genuine data attached by code.

The planner and scene-synth each ship an ``agents`` package; importing both in one process
needs sys.modules isolation (``_load_planner_agent``), handled here so callers don't have to.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from typing import Any, Callable, Optional

REPO = Path(__file__).resolve().parents[1]

for _p in (
    str(REPO / "tools"),
    str(REPO / "packages" / "lesson-plan-schema" / "python"),
):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from capsule_runner import run_capsule  # noqa: E402
from lesson_plan_schema import CorpusRef, RefType, SceneOutline, SceneType  # noqa: E402


def _load_planner_agent():
    """Import the planner's ``PlannerAgent`` without letting its ``agents`` package collide
    with scene-synth's. Stashes any loaded ``agents.*`` modules, imports the planner under a
    clean namespace, then restores BOTH sys.modules AND sys.path so a later scene-synth import
    (or any other code in this process) is not left with the planner's dirs prepended.

    INVARIANT this relies on: PlannerAgent must not lazy-import ``agents.*`` inside generate() —
    it imports agents.base at module top (captured as BaseAgent), and its call-time imports
    (lesson_plan_schema, abs_reader) are cached / re-added by the planner itself. If a future
    planner edit lazy-imports ``agents.*`` at call time, restore the path/modules around the call
    instead."""
    saved_path = list(sys.path)
    for p in (
        str(REPO / "packages" / "lesson-plan-schema" / "python"),
        str(REPO / "services" / "ingest"),
        str(REPO / "services" / "planner"),  # inserted LAST -> first on sys.path
    ):
        if p in sys.path:
            sys.path.remove(p)
        sys.path.insert(0, p)
    stashed = {
        k: sys.modules.pop(k)
        for k in list(sys.modules)
        if k == "agents" or k.startswith("agents.")
    }
    try:
        mod = importlib.import_module("agents.planner_agent")
        return mod.PlannerAgent
    finally:
        for k in list(sys.modules):
            if k == "agents" or k.startswith("agents."):
                del sys.modules[k]
        sys.modules.update(stashed)
        sys.path[:] = saved_path


def _load_scene_synth():
    """Import scene-synth's orchestrator + bundler with its ``agents`` package resolvable."""
    ss = str(REPO / "services" / "scene-synth")
    if ss in sys.path:
        sys.path.remove(ss)
    sys.path.insert(0, ss)
    for k in list(sys.modules):
        if k == "agents" or k.startswith("agents."):
            del sys.modules[k]
    orch_mod = importlib.import_module("orchestrator")
    bundler_mod = importlib.import_module("bundler")
    return orch_mod.SceneSynthOrchestrator, bundler_mod.build_bundle


def _inject_judgment_outlines(plan, specs: list[dict]) -> None:
    """Guarantee a spot_the_flaw outline + a resolvable abs_capsule corpus_ref per spec.

    A spec: ``{capsule_dir, task_card_id, objective_ref?, title?}``. Idempotent — skips a
    card the planner already emitted a judgment outline for (so native + injected agree)."""
    for spec in specs:
        tcid = spec["task_card_id"]
        cap_dir = spec["capsule_dir"]
        if not any(
            r.ref_type == RefType.abs_capsule
            and (r.abs_task_card_ids or []) and tcid in r.abs_task_card_ids
            for r in plan.corpus_refs
        ):
            plan.corpus_refs.append(
                CorpusRef(
                    ref_id=f"cap-{tcid}",
                    ref_type=RefType.abs_capsule,
                    abs_capsule_path=cap_dir,
                    abs_task_card_ids=[tcid],
                )
            )
        if not any(
            s.type == SceneType.spot_the_flaw and s.abs_task_card_id == tcid
            for s in plan.scene_outlines
        ):
            orefs = (
                [spec["objective_ref"]]
                if spec.get("objective_ref")
                else [o.id for o in plan.learning_objectives[:1]]
            )
            plan.scene_outlines.append(
                SceneOutline(
                    id=f"s-judge-{tcid}",
                    type=SceneType.spot_the_flaw,
                    title=spec.get("title", "Auditer une lecture IA d'un résultat exécuté"),
                    objective_refs=orefs,
                    abs_task_card_id=tcid,
                )
            )


def compose_lesson(
    manifest: dict[str, Any],
    *,
    judgment_capsules: Optional[list[dict]] = None,
    out_dir: str | Path,
    options: Optional[dict] = None,
    scene_llm: Any = None,
    critic: Any = None,
    orchestrator: Any = None,
    planner: Any = None,
    bundler_fn: Optional[Callable] = None,
    capsule_runner: Optional[Callable] = None,
) -> dict[str, Any]:
    """Run the chain and return the SceneSynthOrchestrator result
    (``bundle_uri`` / ``scenes_generated`` / ``prov_graph_nodes`` / ``warnings``).

    ``orchestrator`` may be injected (tests / custom agent wiring); otherwise a default is
    built from ``scene_llm`` + ``critic`` (the live path). ``capsule_runner`` defaults to
    tools/capsule_runner.run_capsule."""
    judgment_capsules = judgment_capsules or []
    options = options or {}

    # 1. PLAN — ask the planner to emit judgment scenes natively where it can.
    planner = planner or _load_planner_agent()()
    plan, _audit = planner.generate(
        {**manifest, "emit_judgment_scenes": True},
        target=manifest["target"],
        duration_minutes=int(manifest.get("duration_minutes", 45)),
    )

    # 2. GROUND — guarantee judgment outlines + resolvable capsule refs for the requested capsules.
    _inject_judgment_outlines(plan, judgment_capsules)
    plan_dict = plan.model_dump(mode="json")

    # 3. SYNTH — run the orchestrator with the capsule executor injected.
    if orchestrator is None:
        SceneSynthOrchestrator, build_bundle = _load_scene_synth()
        capsule_root = (
            Path(judgment_capsules[0]["capsule_dir"]).parent
            if judgment_capsules
            else Path(out_dir)
        )
        # Default runner writes capsule artifacts UNDER the bundle output dir (with the
        # bundle), never next to the source capsule.
        runs_dir = Path(out_dir) / "capsule-runs"
        default_runner = capsule_runner or (
            lambda d: run_capsule(d, out_dir=runs_dir / Path(d).name)
        )
        orchestrator = SceneSynthOrchestrator(
            scene_llm,
            critic,
            abs_capsule_root=capsule_root,
            output_dir=Path(out_dir),
            bundler_fn=bundler_fn or build_bundle,
            capsule_runner=default_runner,
        )

    return orchestrator.synthesize_lesson(plan_dict, options)


__all__ = ["compose_lesson"]
