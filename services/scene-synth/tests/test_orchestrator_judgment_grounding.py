"""SceneSynthOrchestrator grounds a ``spot_the_flaw`` scene in a REAL capsule run.

The composition-chain grounding step: when a ``spot_the_flaw`` outline references an
``abs_capsule`` AND a ``capsule_runner`` is injected, the orchestrator
  1. resolves the capsule from the plan's ``corpus_refs`` and runs it ONCE (memoized),
  2. enriches the outline with the verified ``reference_run`` (so the LLM reads real
     values, never invents them) + the authored trustworthiness dial, and
  3. attaches the executed run as ``reference_result`` (code-attached, non-hallucinable)
     before bundling.

Hermetic: stub agent + a FAKE capsule_runner (no uv venv, no key). The real-capsule
end-to-end path is covered by tools/test_compose_lesson.py.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from orchestrator import SceneSynthOrchestrator
from scene_synth_schemas import SpotTheFlawScene


# A capsule_runner result in the shape tools/capsule_runner.run_capsule emits.
_RUN = {
    "task_id": "demo-decay-fit",
    "title": "Estimate a first-order rate constant",
    "research_question": "What is k (and the half-life) of a first-order decay?",
    "status": "ran",
    "passed": True,
    "landmark": "LANDMARK k_fit=0.4212 half_life=1.6457",
    "checks": [{"check": "file exists: outputs/stats.csv", "passed": True}],
    "scene_assets": {"image_path": "decay.png"},
    "doi": "10.0000/demo.decay-fit",
    "provenance": {"cmd": ["python", "scripts/run.py"]},
}


class _RecordingFlawAgent:
    """Stub spot_the_flaw agent that records the (enriched) outline it received and
    returns a valid SpotTheFlawScene the orchestrator can attach reference_result to."""

    scene_type = "spot_the_flaw"

    def __init__(self) -> None:
        self.seen: dict | None = None

    def synthesize(self, outline, context):
        self.seen = outline
        return SpotTheFlawScene(
            id="s-flaw-1",
            type="spot_the_flaw",
            title="Audit",
            flawed_content="Lecture IA plausible mais defectueuse du resultat reel.",
            claims=[{"id": "f1", "text": "demi-vie > 1 h", "flaws_expected": ["demi-vie", "unites"]}],
            model_correction="k est un taux (1/temps) ; demi-vie ~1.65, pas une heure.",
            rubric={"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
        )


def _orchestrator(tmp_path, agent, capsule_runner):
    orch = SceneSynthOrchestrator.__new__(SceneSynthOrchestrator)
    orch.agents = {"spot_the_flaw": agent}
    orch.output_dir = tmp_path
    orch.prov_seed = {}
    orch.capsule_runner = capsule_runner
    captured: dict = {}

    def _bundler_fn(*, lesson_plan, scenes, output_path, prov_seed):
        captured["scenes"] = scenes
        return "file://stub"

    orch.bundler_fn = _bundler_fn
    return orch, captured


_PLAN = {
    "id": "L1",
    "lesson_id": "L1",
    "corpus_refs": [
        {
            "ref_id": "cap",
            "ref_type": "abs_capsule",
            "abs_capsule_path": "/some/capsule-demo",
            "abs_task_card_ids": ["demo-decay-fit"],
        }
    ],
    "scene_outlines": [
        {
            "id": "s-flaw-1",
            "type": "spot_the_flaw",
            "title": "Auditer la lecture IA",
            "objective_refs": ["o-kin"],
            "abs_task_card_id": "demo-decay-fit",
        }
    ],
}


def test_orchestrator_grounds_spot_the_flaw_with_capsule_run(tmp_path):
    runs: list[str] = []

    def _fake_runner(capsule_dir):
        runs.append(str(capsule_dir))
        return _RUN

    agent = _RecordingFlawAgent()
    orch, captured = _orchestrator(tmp_path, agent, _fake_runner)

    orch.synthesize_lesson(_PLAN, {"judgment_n_flaws": 2, "judgment_level": "blatant"})

    # capsule resolved from corpus_refs + run exactly once
    assert runs == ["/some/capsule-demo"]
    # the agent saw an outline grounded in the verified run + the authored dial
    assert agent.seen["reference_run"]["landmark"] == _RUN["landmark"]
    assert agent.seen["reference_run"]["research_question"] == _RUN["research_question"]
    assert agent.seen["trustworthiness"]["n_flaws"] == 2
    assert agent.seen["trustworthiness"]["level"] == "blatant"
    # the synthesized scene carries the executed run as reference_result (code-attached)
    scene = captured["scenes"][0]
    assert isinstance(scene, SpotTheFlawScene)
    assert scene.reference_result is not None
    assert scene.reference_result.ran is True
    assert scene.reference_result.landmark == _RUN["landmark"]
    assert scene.reference_result.figure_path == "decay.png"


def test_spot_the_flaw_without_runner_is_warned_not_grounded(tmp_path):
    """No capsule_runner injected (the default FastAPI path): the judgment scene is
    still synthesized but left ungrounded, with an explicit warning — honest, never a
    fabricated reference_result."""
    agent = _RecordingFlawAgent()
    orch, captured = _orchestrator(tmp_path, agent, None)

    result = orch.synthesize_lesson(_PLAN, {})

    scene = captured["scenes"][0]
    assert scene.reference_result is None
    assert any("not grounded" in w for w in result["warnings"])


def test_capsule_run_is_memoized_across_judgment_scenes(tmp_path):
    """Two judgment scenes pointing at the same capsule trigger a single run."""
    runs: list[str] = []

    def _fake_runner(capsule_dir):
        runs.append(str(capsule_dir))
        return _RUN

    plan = {
        **_PLAN,
        "scene_outlines": [
            dict(_PLAN["scene_outlines"][0], id="s-flaw-1"),
            dict(_PLAN["scene_outlines"][0], id="s-flaw-2"),
        ],
    }
    orch, captured = _orchestrator(tmp_path, _RecordingFlawAgent(), _fake_runner)
    orch.synthesize_lesson(plan, {})

    assert runs == ["/some/capsule-demo"]  # one run, two grounded scenes
    assert len(captured["scenes"]) == 2
    assert all(s.reference_result is not None for s in captured["scenes"])
