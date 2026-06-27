"""End-to-end COMPOSITION CHAIN test: planner -> scene-synth -> grounded judgment bundle.

This is the chain the gap analysis flagged as missing: a single call takes a corpus
manifest, runs the PLANNER to produce a lesson plan, then runs SCENE-SYNTH to synthesize
the scenes — and for the ``spot_the_flaw`` judgment scene it executes the REAL capsule
(fixtures/capsule-demo, isolated uv venv) and attaches the genuine landmark as a
code-attached ``reference_result``.

The scene-synth LLM is a deterministic stub (no API key needed); the GROUNDING is real —
the landmark the learner audits comes from a true execution, not the model. Non-judgment
scenes use trivial stub agents (this test is about the chain + grounding, not their prose).

Requires ``uv`` (the capsule runner builds an isolated venv). ~a few seconds.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
# NB: scene-synth's ``agents`` package must win here; the planner is loaded in isolation by
# compose_lesson (sys.modules juggling), so we deliberately do NOT put it on sys.path.
for _p in (
    REPO / "packages" / "lesson-plan-schema" / "python",
    REPO / "services" / "scene-synth",
    REPO / "tools",
):
    sys.path.insert(0, str(_p))

from capsule_runner import run_capsule  # noqa: E402
from compose_lesson import compose_lesson  # noqa: E402
from orchestrator import SceneSynthOrchestrator  # noqa: E402
from agents.spot_the_flaw_agent import SpotTheFlawAgent  # noqa: E402
from scene_synth_schemas import SpotTheFlawScene  # noqa: E402

CAPSULE = REPO / "fixtures" / "capsule-demo"

# a valid spot_the_flaw scene; its prose is irrelevant — the landmark the learner audits
# is the GROUNDED reference_result, attached by code from the real run (not this JSON).
_VALID_FLAW_JSON = (
    '{"id": "s_flaw_1", "type": "spot_the_flaw", "title": "Lecture IA du k mesure",'
    ' "concept_refs": ["c-kinetics"],'
    ' "flawed_content": "Le fit donne k=0.42 : reaction lente, demi-vie au-dela d une heure.",'
    ' "claims": [{"id": "f1", "text": "demi-vie > 1 h", "flaws_expected": ["demi-vie", "unites"]}],'
    ' "model_correction": "k=0.42 par unite de temps -> demi-vie ~1.65, pas une heure.",'
    ' "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1}}'
)


class _StubSceneLLM:
    def complete(self, prompt: str) -> str:
        return _VALID_FLAW_JSON


class _PassCritic:
    def review(self, scene, plan_section):
        class _R:
            passed = True

        return _R()


class _StubScene:
    def __init__(self, sid):
        self.id = sid
        self.objective_refs = []
        self.concept_refs = []


class _StubAgent:
    """Trivial non-judgment agent (intro/concept/quiz/reproduction): the chain test does
    not assert on their prose, only on the grounded judgment scene."""

    def __init__(self, scene_type):
        self.scene_type = scene_type

    def synthesize(self, outline, context):
        return _StubScene(outline["id"])


def _injected_orchestrator(tmp_path, captured):
    """An orchestrator whose only REAL agent is SpotTheFlawAgent (stub LLM) + the REAL
    run_capsule, so the judgment scene is genuinely grounded while the rest is stubbed."""
    orch = SceneSynthOrchestrator.__new__(SceneSynthOrchestrator)
    orch.agents = {
        "intro": _StubAgent("intro"),
        "concept": _StubAgent("concept"),
        "quiz": _StubAgent("quiz"),
        "reproduction": _StubAgent("reproduction"),
        "spot_the_flaw": SpotTheFlawAgent(_StubSceneLLM(), _PassCritic()),
    }
    orch.output_dir = tmp_path
    orch.prov_seed = {}
    # write the capsule's run artifacts under the test's tmp dir (never the source tree)
    orch.capsule_runner = lambda d: run_capsule(d, out_dir=tmp_path / "capsule-run")

    def _bundler_fn(*, lesson_plan, scenes, output_path, prov_seed):
        captured["scenes"] = scenes
        captured["plan"] = lesson_plan
        return "file://stub"

    orch.bundler_fn = _bundler_fn
    return orch


@pytest.mark.skipif(shutil.which("uv") is None, reason="capsule runner needs uv")
def test_compose_lesson_produces_grounded_judgment_bundle(tmp_path):
    captured: dict = {}
    manifest = {
        "manifest_id": "m-chain-demo",
        "target": "grad",
        "duration_minutes": 20,
        "language": "fr",
        "corpus_refs": [],
    }

    result = compose_lesson(
        manifest,
        judgment_capsules=[
            {
                "capsule_dir": str(CAPSULE),
                "task_card_id": "demo-decay-fit",
                "objective_ref": "obj-1",
                "title": "Auditer une lecture IA d'un resultat execute",
            }
        ],
        out_dir=tmp_path,
        options={"judgment_n_flaws": 1, "judgment_level": "subtle"},
        orchestrator=_injected_orchestrator(tmp_path, captured),
    )

    # the plan that reached the bundler has a spot_the_flaw outline AND the capsule corpus ref
    plan = captured["plan"]
    outline_types = [s["type"] for s in plan["scene_outlines"]]
    assert "spot_the_flaw" in outline_types
    assert any(r["ref_type"] == "abs_capsule" for r in plan["corpus_refs"])

    # the judgment scene is grounded in the REAL execution (landmark from the run, not the LLM)
    flaws = [s for s in captured["scenes"] if isinstance(s, SpotTheFlawScene)]
    assert len(flaws) == 1
    rr = flaws[0].reference_result
    assert rr is not None and rr.ran is True
    assert rr.landmark and "k_fit=" in rr.landmark
    assert result["scenes_generated"] >= 1
