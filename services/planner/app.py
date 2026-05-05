"""Planner service — FastAPI app."""
from __future__ import annotations
from fastapi import FastAPI

from schemas import PlanRequest, PlanResponse, PlanStatus
from mimosa_wrapper import generate
from critic import review

app = FastAPI(title="Studium Planner Service", version="1.0.0")


@app.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    """Generate a lesson plan from a corpus manifest, then score it with the critic.

    Validation Pydantic active à chaque étape (rule 002).
    Le plan retourné est en status=critic_reviewed ; l'enseignant doit approuver (rule 003).
    """
    manifest_dict = request.model_dump()
    lesson_plan = generate(manifest_dict, target=request.target)

    critic_result = review(lesson_plan)

    lesson_plan.critic_score = critic_result["score"]
    lesson_plan.critic_annotations = critic_result["annotations"]
    lesson_plan.status = PlanStatus.critic_reviewed

    return PlanResponse(
        lesson_plan=lesson_plan,
        critic_score=critic_result["score"],
        critic_annotations=critic_result["annotations"],
    )
