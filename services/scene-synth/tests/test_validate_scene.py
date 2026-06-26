"""P0 — tests for the pure ``validate_scene(scene_dict, *, course_concept_ids)`` helper.

These are LLM-free, deterministic checks. They assert:
- valid quiz / spot_the_flaw / explain_back scenes pass (full Scene-union contract);
- quiz choice cardinality (<2 / >6) fails via the schema (min_length/max_length);
- quiz exactly-one-correct: 0-correct and 2-correct fail (NOT in schema — custom check);
- a dangling ``concept_refs`` (not ⊆ course concepts) fails for EVERY scene type;
- ``build_bundle`` keeps calling ``validate_scene`` so single- and full-bundle
  validation never diverge (existing fixtures still build).
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from bundler import build_bundle, validate_scene  # noqa: E402
from scene_synth_schemas import IntroScene  # noqa: E402


# --------------------------------------------------------------------------- #
# Scene dict builders (schema-pure Scene members).
# --------------------------------------------------------------------------- #


def _quiz(*, n_correct: int = 1, n_choices: int = 4, concept_refs=None) -> dict:
    choices = []
    for i in range(n_choices):
        choices.append(
            {"id": f"ch{i}", "text": f"choice {i}", "correct": i < n_correct}
        )
    return {
        "id": "q1",
        "type": "quiz",
        "title": "Quiz",
        "objective_refs": [],
        "concept_refs": ["c1"] if concept_refs is None else concept_refs,
        "estimated_seconds": 30,
        "adaptation_hooks": [],
        "question": "What is 1 + 1?",
        "choices": choices,
        "feedback_correct": "Yes.",
        "feedback_incorrect": "No.",
        "hints": [],
    }


def _spot_the_flaw(*, concept_refs=None) -> dict:
    return {
        "id": "stf1",
        "type": "spot_the_flaw",
        "title": "Spot the flaw",
        "objective_refs": [],
        "concept_refs": ["c1"] if concept_refs is None else concept_refs,
        "estimated_seconds": 60,
        "adaptation_hooks": [],
        "flawed_content": "The Earth is flat and at the centre.",
        "claims": [
            {
                "id": "cl1",
                "text": "The Earth is flat.",
                "flaws_expected": ["sphere", "round"],
            }
        ],
        "model_correction": "The Earth is an oblate spheroid.",
        "rubric": {"completeness": 1.0, "evidence_quality": 1.0, "tone": 1.0},
    }


def _explain_back(*, concept_refs=None) -> dict:
    return {
        "id": "eb1",
        "type": "explain_back",
        "title": "Explain back",
        "objective_refs": [],
        "concept_refs": ["c1"] if concept_refs is None else concept_refs,
        "estimated_seconds": 90,
        "adaptation_hooks": [],
        "prompt": "Explain radial nodes.",
        "key_points": [
            {"id": "kp1", "text": "n - l - 1", "cues": ["radial", "nodes"]}
        ],
        "model_explanation": "Radial nodes equal n minus l minus one.",
        "rubric": {"completeness": 1.0, "evidence_quality": 1.0, "tone": 1.0},
    }


_COURSE = ["c1", "c2"]


# --------------------------------------------------------------------------- #
# Valid scenes pass (full union).
# --------------------------------------------------------------------------- #


def test_valid_quiz_passes():
    res = validate_scene(_quiz(), course_concept_ids=_COURSE)
    assert res["ok"] is True
    assert res["errors"] == []
    assert isinstance(res["validator_version"], str) and res["validator_version"]


def test_valid_spot_the_flaw_passes():
    res = validate_scene(_spot_the_flaw(), course_concept_ids=_COURSE)
    assert res["ok"] is True
    assert res["errors"] == []


def test_valid_explain_back_passes():
    res = validate_scene(_explain_back(), course_concept_ids=_COURSE)
    assert res["ok"] is True
    assert res["errors"] == []


# --------------------------------------------------------------------------- #
# Quiz choice cardinality (schema-enforced).
# --------------------------------------------------------------------------- #


def test_quiz_too_few_choices_fails():
    res = validate_scene(_quiz(n_choices=1), course_concept_ids=_COURSE)
    assert res["ok"] is False
    assert res["errors"]


def test_quiz_too_many_choices_fails():
    res = validate_scene(_quiz(n_choices=7), course_concept_ids=_COURSE)
    assert res["ok"] is False
    assert res["errors"]


# --------------------------------------------------------------------------- #
# Quiz exactly-one-correct (custom check, NOT in schema).
# --------------------------------------------------------------------------- #


def test_quiz_zero_correct_fails():
    res = validate_scene(_quiz(n_correct=0), course_concept_ids=_COURSE)
    assert res["ok"] is False
    assert any("correct" in e.lower() for e in res["errors"])


def test_quiz_two_correct_fails():
    res = validate_scene(_quiz(n_correct=2), course_concept_ids=_COURSE)
    assert res["ok"] is False
    assert any("correct" in e.lower() for e in res["errors"])


def test_exactly_one_correct_applies_only_to_quiz():
    # spot_the_flaw / explain_back have no `choices`; the quiz-only check must
    # not spuriously fire on them.
    assert validate_scene(_spot_the_flaw(), course_concept_ids=_COURSE)["ok"] is True
    assert validate_scene(_explain_back(), course_concept_ids=_COURSE)["ok"] is True


# --------------------------------------------------------------------------- #
# concept_refs ⊆ course concepts — every scene type.
# --------------------------------------------------------------------------- #


def test_quiz_dangling_concept_ref_fails():
    res = validate_scene(
        _quiz(concept_refs=["c1", "nope"]), course_concept_ids=_COURSE
    )
    assert res["ok"] is False
    assert any("nope" in e for e in res["errors"])


def test_spot_the_flaw_dangling_concept_ref_fails():
    res = validate_scene(
        _spot_the_flaw(concept_refs=["ghost"]), course_concept_ids=_COURSE
    )
    assert res["ok"] is False
    assert any("ghost" in e for e in res["errors"])


def test_explain_back_dangling_concept_ref_fails():
    res = validate_scene(
        _explain_back(concept_refs=["ghost"]), course_concept_ids=_COURSE
    )
    assert res["ok"] is False
    assert any("ghost" in e for e in res["errors"])


def test_empty_concept_refs_pass():
    # ⊆ holds vacuously; no concept claim made.
    res = validate_scene(_quiz(concept_refs=[]), course_concept_ids=_COURSE)
    assert res["ok"] is True


# --------------------------------------------------------------------------- #
# build_bundle still uses validate_scene (single == full validation).
# --------------------------------------------------------------------------- #


def _plan() -> dict:
    return {
        "lesson_id": "vs-test",
        "plan_id": "plan-vs-test",
        "title": "VS Test",
        "metadata": {
            "title": "VS Test",
            "target": "L3",
            "duration_minutes": 10,
            "language": "fr",
            "discipline": "test",
        },
        "concepts": [
            {
                "id": "c1",
                "title": "Concept 1",
                "description": "A concept.",
                "bloom_level_target": "understand",
            }
        ],
        "rules": [],
    }


def test_build_bundle_still_builds(tmp_path):
    scenes = [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=["c1"],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="hi",
        )
    ]
    prov_seed = {"agent": "scene-synth", "version": "0.1.0", "validator": "test"}
    uri = build_bundle(_plan(), scenes, tmp_path / "b.zip", prov_seed)
    assert uri.startswith("file://")


def test_build_bundle_rejects_dangling_concept_ref(tmp_path):
    scenes = [
        IntroScene(
            id="s0",
            type="intro",
            title="T",
            objective_refs=[],
            concept_refs=["does-not-exist"],
            estimated_seconds=60,
            adaptation_hooks=[],
            markdown="hi",
        )
    ]
    prov_seed = {"agent": "scene-synth", "version": "0.1.0", "validator": "test"}
    import pytest

    with pytest.raises(ValueError):
        build_bundle(_plan(), scenes, tmp_path / "b.zip", prov_seed)
