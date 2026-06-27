"""Integration test — the capsule-grounded JUDGMENT slice, hermetic (no capsule run, no key).

Exercises agent -> ground_judgment -> schema, end to end with a stubbed LLM and a FAKE capsule
result, so it asserts the GLUE without uv/network/API: a generated spot_the_flaw scene, once a
real run is attached via ground_spot_the_flaw, still validates AND carries the run as a typed
``reference_result``. The real-execution + real-LLM path is exercised by
tools/build_capsule_judgment_demo.py (run out of band).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# tools/ is not a package; add it for ground_judgment (same trick eval/harness/repro_enrich uses).
REPO = Path(__file__).resolve().parents[4]  # prototype-build/
sys.path.insert(0, str(REPO / "tools"))

from ground_judgment import ground_spot_the_flaw, reference_result_from_capsule  # noqa: E402
from agents.spot_the_flaw_agent import SpotTheFlawAgent  # noqa: E402
from scene_synth_schemas import SpotTheFlawScene  # noqa: E402


_LANDMARK = "LANDMARK k_fit=0.4212 half_life=1.6457"

# A FAKE capsule_runner result (the shape run_capsule returns on a successful run).
_CAPSULE_RESULT = {
    "status": "ran",
    "passed": True,
    "doi": "10.0000/demo.decay-fit",
    "landmark": _LANDMARK,
    "checks": [{"check": "file exists: outputs/stats.csv", "passed": True}],
    "scene_assets": {"image_path": "decay.png"},
    "provenance": {"cmd": ["python", "scripts/run.py"]},
}


class _StubLLM:
    def complete(self, prompt: str) -> str:
        return json.dumps(
            {
                "id": "s-flaw-test",
                "type": "spot_the_flaw",
                "title": "Audit d'une lecture IA",
                "concept_refs": ["c-kinetics"],
                "flawed_content": f"Lecture IA du resultat reel ({_LANDMARK}) : demi-vie > 1 h.",
                "claims": [{"id": "f1", "text": "demi-vie > 1 h", "flaws_expected": ["demi-vie", "unites"]}],
                "model_correction": f"Ancre sur {_LANDMARK} : demi-vie = ln2/k.",
                "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
            },
            ensure_ascii=False,
        )


class _PassCritic:
    def review(self, scene, plan_section):
        class _R:
            passed = True

        return _R()


def _outline() -> dict:
    return {
        "id": "s-flaw-test",
        "title": "Audit d'une lecture IA",
        "objective_text": "Auditer une lecture IA d'un resultat reel",
        "concept_id": "c-kinetics",
        "concept_refs": ["c-kinetics"],
        "reference_run": {
            "title": "Estimate a first-order rate constant",
            "research_question": "What is k of a first-order decay?",
            "landmark": _LANDMARK,
            "checks": _CAPSULE_RESULT["checks"],
        },
        "trustworthiness": {"level": "subtle", "n_flaws": 1, "guidance": "subtil"},
    }


def test_generated_scene_grounds_in_a_real_run_and_still_validates():
    agent = SpotTheFlawAgent(_StubLLM(), _PassCritic())
    scene = agent.synthesize(_outline(), {})

    d = scene.model_dump(exclude_none=True)
    assert "reference_result" not in d  # the LLM does NOT fabricate the run

    ground_spot_the_flaw(d, _CAPSULE_RESULT)

    # the attached run validates as part of the scene (TS/Python carrier parity)
    revalidated = SpotTheFlawScene.model_validate(d)
    assert revalidated.reference_result is not None
    assert revalidated.reference_result.landmark == _LANDMARK
    assert revalidated.reference_result.figure_path == "decay.png"
    assert revalidated.reference_result.provenance.cmd == ["python", "scripts/run.py"]
    # the flaws (answer key) live on claims, NOT in the attached run — surfacing it is not a leak
    assert revalidated.claims[0].flaws_expected


def test_non_ran_capsule_leaves_scene_ungrounded():
    d = {"id": "x", "type": "spot_the_flaw", "title": "t", "flawed_content": "c",
         "claims": [{"id": "f", "text": "t", "flaws_expected": ["k"]}],
         "model_correction": "m", "rubric": {"completeness": 0.5, "evidence_quality": 0.3, "tone": 0.2}}
    ground_spot_the_flaw(d, {"status": "deferred", "reason": "heavy"})
    assert "reference_result" not in d


def test_reference_result_projection_shape():
    rr = reference_result_from_capsule(_CAPSULE_RESULT)
    assert rr["ran"] is True and rr["passed"] is True
    assert rr["landmark"] == _LANDMARK
    assert rr["provenance"]["capsule_doi"] == "10.0000/demo.decay-fit"
    assert rr["provenance"]["env"].startswith("isolated uv venv")
