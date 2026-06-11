"""SceneSynthOrchestrator (A.7).

Wires the six SceneAgents (intro, concept, quiz, meta_checkpoint,
reproduction, ai_critique) to the bundler and returns the result of
``synthesize_lesson`` in the shape expected by the FastAPI endpoint
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
from bundler import build_bundle


log = logging.getLogger(__name__)


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
        }
        self.output_dir = Path(output_dir)
        self.prov_seed = prov_seed or {
            "agent": "scene-synth",
            "version": "0.1.0",
        }
        self.bundler_fn = bundler_fn

    def synthesize_lesson(
        self, lesson_plan: dict, options: dict
    ) -> dict[str, Any]:
        scenes: list[Any] = []
        warnings: list[str] = []
        context: dict[str, Any] = {"warnings": warnings}

        outlines = lesson_plan.get("scene_outlines") or lesson_plan.get(
            "scenes", []
        )
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
            scene = agent.synthesize(outline, context)
            _orefs = list(outline.get("objective_refs") or [])
            scene.objective_refs = _orefs
            scene.concept_refs = _orefs   # concept id-space == objective id-space (LWG concept:<obj.id>)
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


__all__ = ["SceneSynthOrchestrator"]
