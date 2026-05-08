import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

import pytest
from lesson_bundle_schema import LessonBundle, IntroScene, QuizScene, AdaptationRule

VALID_BUNDLE = {
    "schema_version": "1.0",
    "bundle_id": "b-001",
    "source_plan_id": "p-001",
    "metadata": {
        "title": "Métabolomique", "target": "L3", "duration_minutes": 30,
        "language": "fr", "discipline": "métabolomique",
    },
    "concepts": [{"id": "c-001", "title": "LC-MS", "description": "x",
                  "bloom_level_target": "understand"}],
    "scenes": [{"id": "s-1", "type": "intro", "title": "B", "objective_refs": [],
                "concept_refs": ["c-001"], "estimated_seconds": 60,
                "adaptation_hooks": [],
                "content": {"markdown": "hello"}}],
    "rules": [{"id": "r-1", "when": {"mastery_c": ">=0.8"},
               "action": {"kind": "skip_to_next_concept"},
               "modulator": "M1", "explanation_short": "ok"}],
    "validated_by": "prof.test@example.com",
    "validated_at": "2026-05-08T10:00:00Z",
}


def test_valid_bundle_parses():
    LessonBundle(**VALID_BUNDLE)


def test_rejects_missing_validated_by():
    invalid = dict(VALID_BUNDLE)
    invalid.pop("validated_by")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_rejects_short_validated_by():
    invalid = dict(VALID_BUNDLE, validated_by="ab")
    with pytest.raises(Exception):
        LessonBundle(**invalid)


def test_quiz_scene_min_choices():
    bad_scene = {"id": "s-q", "type": "quiz", "title": "Q",
                 "objective_refs": [], "concept_refs": [], "estimated_seconds": 60,
                 "adaptation_hooks": [],
                 "content": {"question": "?",
                             "choices": [{"id": "a", "text": "A", "correct": True}],
                             "feedback_correct": "y", "feedback_incorrect": "n", "hints": []}}
    with pytest.raises(Exception):
        QuizScene(**bad_scene)


def test_meta_checkpoint_5_labels():
    bad = {"id": "m1", "type": "meta_checkpoint", "title": "M",
           "objective_refs": [], "concept_refs": [], "estimated_seconds": 30,
           "adaptation_hooks": [],
           "content": {"pre_question": "p", "post_question": "post",
                       "scale_labels": ["a", "b"]}}
    with pytest.raises(Exception):
        from lesson_bundle_schema import MetaCheckpointScene
        MetaCheckpointScene(**bad)
