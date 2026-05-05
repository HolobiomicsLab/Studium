import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))

import pytest
from pydantic import ValidationError
from lesson_plan_schema import LessonPlan, LearningObjective, SceneOutline, CorpusRef, PlanMetadata


SAMPLE = {
    "schema_version": "1.0",
    "id": "plan-001",
    "title": "Introduction à la métabolomique",
    "language": "fr",
    "target": "L3",
    "duration_minutes": 45,
    "learning_objectives": [
        {"id": "obj-1", "description": "Comprendre les bases", "bloom_level": "understand"}
    ],
    "scene_outlines": [
        {"id": "sc-1", "type": "intro", "title": "Intro", "objective_refs": ["obj-1"]},
        {"id": "sc-2", "type": "concept", "title": "Concepts", "objective_refs": ["obj-1"]},
    ],
    "corpus_refs": [
        {"ref_id": "ref-1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}
    ],
    "status": "draft",
    "metadata": {"subject": "Métabolomique", "author": "Prof. Dupont", "created": "2026-05-05"},
}


def test_lesson_plan_accepts_sample():
    plan = LessonPlan(**SAMPLE)
    assert plan.id == "plan-001"
    assert plan.status.value == "draft"
    assert len(plan.learning_objectives) == 1
    assert len(plan.scene_outlines) == 2


def test_lesson_plan_rejects_empty():
    with pytest.raises(ValidationError):
        LessonPlan()


def test_lesson_plan_rejects_invalid_bloom():
    bad = {**SAMPLE, "learning_objectives": [
        {"id": "o1", "description": "x", "bloom_level": "unknown_level"}
    ]}
    with pytest.raises(ValidationError):
        LessonPlan(**bad)


def test_lesson_plan_rejects_invalid_status():
    bad = {**SAMPLE, "status": "published"}
    with pytest.raises(ValidationError):
        LessonPlan(**bad)


def test_critic_score_bounds():
    plan = LessonPlan(**{**SAMPLE, "critic_score": 0.85, "status": "critic_reviewed"})
    assert plan.critic_score == 0.85

    with pytest.raises(ValidationError):
        LessonPlan(**{**SAMPLE, "critic_score": 1.5})
