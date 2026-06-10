"""Planner service — FastAPI app. M2 : utilise PlannerAgent + CriticAgent explicites."""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI

from planner_schemas import PlanRequest, PlanResponse, PlanStatus, CritiqueResult
from agents.planner_agent import PlannerAgent
from agents.critic_agent import CriticAgent
from ontology.prov import build_prov_graph
from evidence.enricher import EvidenceEnricher

app = FastAPI(title="Studium Planner Service", version="2.0.0")

_planner = PlannerAgent()
_critic = CriticAgent()


def _get_perspicacite_client():
    """Factory d'injection. Retourne le client MCP Perspicacité live si activé
    (STUDIUM_PERSPICACITE_ENABLED=on), sinon None (enrichissement skippé).
    Testable via patch("planner_app._get_perspicacite_client")."""
    import sys, os as _os
    _here = _os.path.dirname(__file__)
    _p = _os.path.join(_here, "../../packages/perspicacite-client/python")
    if _p not in sys.path:
        sys.path.insert(0, _p)
    from perspicacite_mcp.client import make_perspicacite_client
    return make_perspicacite_client()


def _get_abs_reader():
    """Factory d'injection ABS — None par défaut."""
    return None


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

    if os.getenv("STUDIUM_EVIDENCE_ENRICH") == "on":
        perspicacite = _get_perspicacite_client()
        abs_reader = _get_abs_reader()
        if perspicacite is not None:
            enricher = EvidenceEnricher(
                perspicacite_client=perspicacite,
                abs_reader=abs_reader,
            )
            lesson_plan = enricher.enrich(lesson_plan)

    return PlanResponse(
        lesson_plan=lesson_plan,
        critic_score=critique.score,
        critic_annotations=critique.annotations,
    )
