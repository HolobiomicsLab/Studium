"""Unit tests for the scene-level content judge — fake LLM, no live calls.

Run:  .venv/bin/python -m pytest eval/tests/test_scene_judge.py -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

EVAL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL_DIR))

from harness.llm import LLMError  # noqa: E402
from harness.scene_judge import (  # noqa: E402
    SceneVerdict, applicable_dimensions, calibrate, corrupt_scene, emit_review_astra,
    judge_bundle, judge_scene, worst,
)

QUIZ = {"id": "s1", "type": "quiz", "question": "Q?",
        "choices": [{"id": "a", "text": "right", "correct": True},
                    {"id": "b", "text": "wrong", "correct": False}]}
FLAW = {"id": "s2", "type": "spot_the_flaw", "flawed_content": "MSI-1 confirmé.",
        "claims": [{"id": "f1", "text": "MSI-1 confirmé", "is_flaw": True},
                   {"id": "c1", "text": "7 fragments partagés", "is_flaw": False}]}
BUNDLE = {"bundle_id": "b1", "language": "fr", "scenes": [QUIZ, FLAW]}


class FakeLLM:
    """Pass verdicts everywhere, except a defect on the corruption's target
    dimension when the scene carries a corruption marker."""

    def complete_json(self, prompt):
        import json as _json
        scene = _json.loads(prompt.split("Scene JSON:\n", 1)[1].split("\n\nJudge EXACTLY", 1)[0])
        out = []
        for dim in applicable_dimensions(scene):
            corrupted = (
                (dim == "key_correctness" and scene.get("type") == "quiz"
                 and not any(c.get("correct") and c["id"] == "a" for c in scene["choices"]))
                or (dim == "flaw_veracity" and scene.get("type") == "spot_the_flaw"
                    and any("reproduit à l'identique" in c["text"] for c in scene["claims"])))
            out.append({"scene_id": scene["id"], "dimension": dim,
                        "verdict": "defect" if corrupted else "pass",
                        "failure_scenario": "learner is credited for a wrong answer" if corrupted else "",
                        "quote": "", "confidence": 0.9})
        return out


class BrokenLLM:
    def complete_json(self, prompt):
        return {"not": "a list"}


def test_verdict_requires_failure_scenario_on_non_pass():
    with pytest.raises(Exception):
        SceneVerdict(scene_id="s", dimension="key_correctness", verdict="defect")
    v = SceneVerdict(scene_id="s", dimension="key_correctness", verdict="defect",
                     failure_scenario="the key is wrong")
    assert v.verdict == "defect"


def test_applicability_by_scene_shape():
    assert "key_correctness" in applicable_dimensions(QUIZ)
    assert "flaw_veracity" not in applicable_dimensions(QUIZ)
    assert "flaw_veracity" in applicable_dimensions(FLAW)
    assert "locale_consistency" in applicable_dimensions(QUIZ)


def test_worst_case_is_never_a_mean():
    assert worst(["pass", "pass", "defect"]) == "defect"
    assert worst(["pass", "suspect"]) == "suspect"
    assert worst([]) == "pass"


def test_judge_scene_validates_and_covers_dimensions():
    verdicts = judge_scene(QUIZ, FakeLLM())
    assert {v.dimension for v in verdicts} == set(applicable_dimensions(QUIZ))
    assert all(v.verdict == "pass" for v in verdicts)


def test_unusable_reply_raises_never_fabricates():
    with pytest.raises(LLMError):
        judge_scene(QUIZ, BrokenLLM())


def test_judge_bundle_records_skips_instead_of_inventing():
    class HalfBroken(FakeLLM):
        def complete_json(self, prompt):
            if '"s2"' in prompt:
                return {"nope": 1}
            return super().complete_json(prompt)
    review = judge_bundle(BUNDLE, HalfBroken())
    assert "s1" in review["scenes"] and "s2" not in review["scenes"]
    assert "s2" in review["skipped"]


def test_calibration_separates_corrupted_from_clean():
    review = calibrate(BUNDLE, FakeLLM())
    assert review["pairs"] == 2
    assert review["kappa"] == 1.0 and review["separates"]


def test_corruptions_are_deterministic_and_marked():
    c1, dim1 = corrupt_scene(QUIZ)
    assert dim1 == "key_correctness" and c1 != QUIZ
    assert corrupt_scene({"id": "x", "type": "intro"}) is None


def test_review_astra_document_conforms_to_the_vendored_contract():
    review = judge_bundle(BUNDLE, FakeLLM())
    doc = emit_review_astra(review)
    from provenance.astra_contract import is_valid_astra_id  # via ensure_planner_importable
    (slug,) = doc["analyses"]
    body = doc["analyses"][slug]
    assert body["decisions"], "review emitted no decisions"
    for did, d in body["decisions"].items():
        assert is_valid_astra_id(did), did
        assert set(d["options"]) == {"pass", "suspect", "defect"}
        assert d["default"] in d["options"]
