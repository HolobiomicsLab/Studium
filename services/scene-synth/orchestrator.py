"""SceneSynthOrchestrator (A.7).

Wires the seven SceneAgents (intro, concept, quiz, meta_checkpoint,
reproduction, ai_critique, spot_the_flaw) to the bundler and returns the result
of ``synthesize_lesson`` in the shape expected by the FastAPI endpoint
``POST /scenes/synthesize``.

Design choices:
- Unsupported scene types are logged as warnings and skipped (never fail
  the lesson on a single bad outline).
- ``ai_critique`` scenes are skipped when ``options.include_critique``
  is False.
- ``SceneSynthError`` from any agent bubbles up to the caller (the
  endpoint maps it to HTTP 502).
- The orchestrator is intentionally schema-tolerant on input: it reads
  ``lesson_plan`` as a dict and accepts both the M2 LessonPlan key
  ``scene_outlines`` and the legacy ``scenes`` alias.
- ``id`` (M2 LessonPlan) and ``lesson_id`` (bundler input) are reconciled
  here so the bundler's strict ``lesson_id`` requirement is met without
  forcing callers to rename fields.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from agents.ai_critique_agent import AICritiqueAgent
from agents.base import SceneSynthError
from agents.concept_agent import ConceptAgent
from agents.intro_agent import IntroAgent
from agents.meta_checkpoint_agent import MetaCheckpointAgent
from agents.quiz_agent import QuizAgent
from agents.reproduction_agent import ReproductionAgent
from agents.spot_the_flaw_agent import SpotTheFlawAgent
from bundler import build_bundle
from scene_synth_schemas import ReferenceRun


log = logging.getLogger(__name__)

# Project a tools/capsule_runner result into a ReferenceRun dict. Canonical home is
# tools/ground_judgment.reference_result_from_capsule — imported here (with a path insert)
# so the projection is NEVER duplicated. The import is ATTEMPTED at module load; if tools/ is
# absent it falls to None and the grounding step (only used when a capsule_runner is injected)
# warns instead of attaching — so a missing tools/ dir degrades gracefully + honestly.
try:  # pragma: no cover - exercised whenever grounding runs
    _TOOLS_DIR = Path(__file__).resolve().parents[2] / "tools"
    if str(_TOOLS_DIR) not in sys.path:
        sys.path.insert(0, str(_TOOLS_DIR))
    from ground_judgment import reference_result_from_capsule as _project_reference_result
except Exception:  # pragma: no cover
    _project_reference_result = None


class SceneSynthOrchestrator:
    """Dispatches scene outlines to the right agent and bundles the result."""

    def __init__(
        self,
        llm_client,
        critic,
        abs_capsule_root: Path,
        output_dir: Path,
        prov_seed: dict | None = None,
        bundler_fn: Callable = build_bundle,
        capsule_runner: Callable | None = None,
    ) -> None:
        self.agents = {
            "intro": IntroAgent(llm_client, critic),
            "concept": ConceptAgent(llm_client, critic),
            "quiz": QuizAgent(llm_client, critic),
            "meta_checkpoint": MetaCheckpointAgent(llm_client, critic),
            "reproduction": ReproductionAgent(
                llm_client, critic, abs_capsule_root=abs_capsule_root
            ),
            "ai_critique": AICritiqueAgent(llm_client, critic),
            # capsule-grounded judgment scene: a flawed AI reading of a REAL executed result,
            # graded by flawGrader. Was schema-only (orchestrator skipped it) — now generative.
            "spot_the_flaw": SpotTheFlawAgent(llm_client, critic),
        }
        self.output_dir = Path(output_dir)
        self.prov_seed = prov_seed or {
            "agent": "scene-synth",
            "version": "0.1.0",
        }
        self.bundler_fn = bundler_fn
        # Optional capsule executor (tools/capsule_runner.run_capsule). When injected, a
        # spot_the_flaw outline that references an abs_capsule is GROUNDED: the capsule is
        # run once and the verified result is attached as reference_result. None (the default
        # FastAPI path) leaves judgment scenes ungrounded + warned — never fabricated.
        self.capsule_runner = capsule_runner

    def synthesize_lesson(
        self, lesson_plan: dict, options: dict
    ) -> dict[str, Any]:
        scenes: list[Any] = []
        warnings: list[str] = []
        context: dict[str, Any] = {"warnings": warnings}

        outlines = lesson_plan.get("scene_outlines") or lesson_plan.get(
            "scenes", []
        )
        corpus_refs = lesson_plan.get("corpus_refs") or []
        capsule_runs: dict[str, dict] = {}  # memoize one run per capsule, per lesson
        for outline in outlines:
            scene_type = outline.get("type")
            agent = self.agents.get(scene_type)
            if agent is None:
                msg = f"unsupported scene type '{scene_type}' skipped"
                log.warning(msg)
                warnings.append(msg)
                continue
            if scene_type == "ai_critique" and not options.get(
                "include_critique", True
            ):
                warnings.append(
                    "ai_critique scene skipped (include_critique=False)"
                )
                continue
            if scene_type == "spot_the_flaw":
                # capsule-grounded JUDGMENT scene: run the real capsule, ground the reading.
                scene = self._synthesize_judgment(
                    agent, outline, context, corpus_refs, options, capsule_runs, warnings
                )
                _orefs = list(outline.get("objective_refs") or [])
                scene.objective_refs = _orefs
                scene.concept_refs = list(_orefs)
                scenes.append(scene)
                continue
            if scene_type == "quiz":
                # Product parity with the eval harness: emit N distinct quiz
                # items per concept (same concept_refs, distinct ids) so the
                # runtime has unseen items for remediation.
                n_items = int(options.get("questions_per_concept", 3))
                _orefs = list(outline.get("objective_refs") or [])
                base = outline.get("id") or (
                    f"s-quiz-{(_orefs[0] if _orefs else 'x')}"
                )
                for i in range(1, n_items + 1):
                    qs = agent.synthesize({**outline, "variant_idx": i}, context)
                    qs.id = f"{base}-{i}"
                    qs.objective_refs = _orefs
                    qs.concept_refs = list(_orefs)
                    scenes.append(qs)
                continue
            scene = agent.synthesize(outline, context)
            _orefs = list(outline.get("objective_refs") or [])
            scene.objective_refs = _orefs
            scene.concept_refs = list(_orefs)   # concept id-space == objective id-space (LWG concept:<obj.id>)
            scenes.append(scene)

        # Reconcile ``id`` (M2 LessonPlan) ↔ ``lesson_id`` (bundler input).
        lesson_id = (
            lesson_plan.get("lesson_id") or lesson_plan.get("id") or "lesson"
        )
        bundler_input = dict(lesson_plan)
        bundler_input.setdefault("lesson_id", lesson_id)

        self.output_dir.mkdir(parents=True, exist_ok=True)
        out_path = self.output_dir / f"{lesson_id}-{uuid4()}.zip"
        bundle_uri = self.bundler_fn(
            lesson_plan=bundler_input,
            scenes=scenes,
            output_path=out_path,
            prov_seed=self.prov_seed,
        )

        # Approximate prov node count: 2 base nodes (Activity + Agent) +
        # 1 per scene. Real count is read from the sidecar if needed.
        prov_nodes = 2 + len(scenes)

        return {
            "bundle_uri": bundle_uri,
            "scenes_generated": len(scenes),
            "prov_graph_nodes": prov_nodes,
            "warnings": warnings,
        }

    # ------------------------------------------------------------------ #
    # Capsule-grounded judgment (spot_the_flaw)
    # ------------------------------------------------------------------ #

    def _synthesize_judgment(
        self, agent, outline, context, corpus_refs, options, capsule_runs, warnings
    ):
        """Synthesize a spot_the_flaw scene, grounding it in a REAL capsule run when one
        is resolvable + a capsule_runner is injected. The flawed READING is the LLM's; the
        executed RESULT is code-attached (``reference_result``) — never hallucinated. If the
        capsule cannot run, the scene is still synthesized (ungrounded) with a warning."""
        run = None
        sid = outline.get("id")
        if self.capsule_runner is None:
            warnings.append(f"spot_the_flaw '{sid}' not grounded: no capsule_runner injected")
        else:
            capsule_dir = self._resolve_capsule(outline, corpus_refs)
            if capsule_dir is None:
                warnings.append(
                    f"spot_the_flaw '{sid}' not grounded: no abs_capsule resolved from corpus_refs"
                )
            else:
                if capsule_dir not in capsule_runs:
                    capsule_runs[capsule_dir] = self.capsule_runner(capsule_dir) or {}
                candidate = capsule_runs[capsule_dir]
                if candidate.get("status") == "ran":
                    run = candidate
                else:
                    warnings.append(
                        f"spot_the_flaw '{sid}' not grounded: capsule status="
                        f"{candidate.get('status')!r}"
                    )

        scene = agent.synthesize(self._judgment_outline(outline, run, options), context)
        if run is not None and hasattr(scene, "reference_result"):
            if _project_reference_result is not None:
                scene.reference_result = ReferenceRun(**_project_reference_result(run))
            else:
                # The capsule RAN but the grounding projector failed to import (tools/ absent in this
                # deployment). Be honest: warn rather than silently ship a real-looking but ungrounded
                # judgment scene. Should never happen in a correctly-deployed tree.
                warnings.append(
                    f"spot_the_flaw '{sid}' ran but the grounding projector is unavailable; "
                    "reference_result not attached"
                )
        return scene

    @staticmethod
    def _resolve_capsule(outline: dict, corpus_refs: list[dict]) -> str | None:
        """Map a judgment outline to a runnable capsule dir via the plan's corpus_refs.

        Matches the outline's ``abs_task_card_id`` against a corpus_ref's
        ``abs_task_card_ids``; falls back to a card-LESS abs_capsule ref, then to the sole
        abs_capsule ref. Returns the ``abs_capsule_path`` (a dir tools/capsule_runner can run)."""
        candidates = [
            r for r in corpus_refs
            if r.get("ref_type") == "abs_capsule" and r.get("abs_capsule_path")
        ]
        want = outline.get("abs_task_card_id")
        if want:
            # 1) an EXACT card match wins (order-independent: never shadowed by a card-less ref).
            for r in candidates:
                if want in (r.get("abs_task_card_ids") or []):
                    return r["abs_capsule_path"]
            # 2) then a card-less capsule ref (lists no task ids ⇒ applies to any card).
            for r in candidates:
                if not (r.get("abs_task_card_ids") or []):
                    return r["abs_capsule_path"]
        if len(candidates) == 1:
            return candidates[0]["abs_capsule_path"]
        return None

    @staticmethod
    def _judgment_outline(outline: dict, run: dict | None, options: dict) -> dict:
        """Enrich a plan-schema spot_the_flaw outline into the section the SpotTheFlawAgent
        prompt expects: concept_id / objective_text / concept_refs, the authored
        trustworthiness dial, and (when grounded) the verified reference_run."""
        orefs = list(outline.get("objective_refs") or [])
        enriched = {
            **outline,
            "concept_id": outline.get("concept_id")
            or (orefs[0] if orefs else outline.get("abs_task_card_id") or ""),
            "objective_text": outline.get("objective_text")
            or outline.get("title")
            or outline.get("notes")
            or "",
            "concept_refs": list(outline.get("concept_refs") or orefs),
            "trustworthiness": {
                "level": options.get("judgment_level", "subtle"),
                "n_flaws": int(options.get("judgment_n_flaws", 1)),
                "guidance": options.get("judgment_guidance", "subtils et crédibles"),
            },
        }
        if run is not None:
            enriched["reference_run"] = {
                "title": run.get("title"),
                "research_question": run.get("research_question"),
                "landmark": run.get("landmark"),
                "checks": run.get("checks") or [],
            }
        return enriched


__all__ = ["SceneSynthOrchestrator"]
