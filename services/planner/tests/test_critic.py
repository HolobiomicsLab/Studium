import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from planner_schemas import LessonPlan


SAMPLE_PLAN = LessonPlan(
    id="p-001",
    title="Introduction à la métabolomique",
    language="fr",
    target="L3",
    duration_minutes=45,
    learning_objectives=[
        {"id": "obj-1", "description": "Comprendre les fondements", "bloom_level": "understand"}
    ],
    scene_outlines=[
        {"id": "sc-1", "type": "intro", "title": "Intro", "objective_refs": ["obj-1"]},
        {"id": "sc-2", "type": "quiz", "title": "Quiz", "objective_refs": ["obj-1"]},
    ],
    corpus_refs=[{"ref_id": "r1", "ref_type": "doi", "doi": "10.1073/pnas.1319030111", "resolved": True}],
    status="draft",
)


def test_review_returns_score_and_annotations():
    from critic import review
    result = review(SAMPLE_PLAN)
    assert "score" in result
    assert "annotations" in result
    assert isinstance(result["score"], float)
    assert isinstance(result["annotations"], list)


def test_review_score_in_range():
    from critic import review
    result = review(SAMPLE_PLAN)
    assert 0.0 <= result["score"] <= 1.0


def test_review_updates_plan_status():
    from critic import review
    result = review(SAMPLE_PLAN)
    # critic should NOT mutate input plan — it returns a dict
    assert SAMPLE_PLAN.status == "draft"
    assert "score" in result
