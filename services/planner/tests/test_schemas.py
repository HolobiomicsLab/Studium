import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from planner_schemas import LessonPlan, PlanRequest, PlanResponse, CorpusRef


def test_plan_request_valid():
    req = PlanRequest(manifest_id="m-001", target="L3")
    assert req.duration_minutes == 45
    assert req.language == "fr"


def test_plan_response_valid():
    plan = LessonPlan(
        id="p-001", title="Test", language="fr", target="L3",
        duration_minutes=45,
        learning_objectives=[{"id": "o1", "description": "x", "bloom_level": "understand"}],
        scene_outlines=[{"id": "sc1", "type": "intro", "title": "Intro", "objective_refs": ["o1"]}],
        status="draft",
    )
    resp = PlanResponse(lesson_plan=plan, critic_score=0.7)
    assert resp.critic_score == 0.7
    assert resp.lesson_plan.id == "p-001"


def test_plan_response_invalid_score():
    import pytest
    from pydantic import ValidationError
    plan = LessonPlan(
        id="p-001", title="Test", language="fr", target="L3",
        duration_minutes=45,
        learning_objectives=[{"id": "o1", "description": "x", "bloom_level": "understand"}],
        scene_outlines=[{"id": "sc1", "type": "intro", "title": "Intro", "objective_refs": []}],
        status="draft",
    )
    with pytest.raises(ValidationError):
        PlanResponse(lesson_plan=plan, critic_score=1.5)
