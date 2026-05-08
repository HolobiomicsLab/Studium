"""Planner service — FastAPI app. M2 : utilise PlannerAgent + CriticAgent explicites."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI

from planner_schemas import PlanRequest, PlanResponse, PlanStatus, CritiqueResult
from agents.planner_agent import PlannerAgent
from agents.critic_agent import CriticAgent
from ontology.prov import build_prov_graph

app = FastAPI(title="Studium Planner Service", version="2.0.0")

_planner = PlannerAgent()
_critic = CriticAgent()


@app.post("/plan", response_model=PlanResponse)
def plan(request: PlanRequest) -> PlanResponse:
    """Génère un plan + critique. Status=critic_reviewed ; validation humaine requise (rule 003)."""
    manifest = request.model_dump()
    lesson_plan, planner_audit = _planner.generate(manifest, target=request.target)

    critique: CritiqueResult = _critic.review(lesson_plan)
    lesson_plan.critic_score = critique.score
    lesson_plan.critic_annotations = critique.annotations
    lesson_plan.status = PlanStatus.critic_reviewed

    prov_graph = build_prov_graph(lesson_plan, manifest, planner_audit, critique)

    return PlanResponse(
        lesson_plan=lesson_plan,
        critic_score=critique.score,
        critic_annotations=critique.annotations,
    )
