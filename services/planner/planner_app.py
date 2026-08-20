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

    if os.getenv("STUDIUM_LWG_BUILD") == "on":
        import logging as _logging
        import re as _re

        _log = _logging.getLogger(__name__)
        # Deterministic, single-segment output dir — computed FIRST so the failure
        # marker path is always known even if the build raises before we get there.
        _safe_id = _re.sub(r"[^A-Za-z0-9_-]", "_", request.manifest_id) or "course"
        _out_dir = os.path.join(os.getenv("STUDIUM_LWG_OUT_DIR", ".lwg"), _safe_id)

        def _emit_lwg_failure(reason: str, *, errors: list | None = None) -> None:
            """Make an LWG-build failure OBSERVABLE: append a telemetry marker.

            Best-effort itself — emitting the marker must never raise out of the
            best-effort block. Paired with a logged ERROR at the call site.
            """
            try:
                from agentic.telemetry import JsonlTelemetrySink
                os.makedirs(_out_dir, exist_ok=True)
                JsonlTelemetrySink(os.path.join(_out_dir, "lwg_build.telemetry.jsonl")).emit({
                    "event": "lwg_build_failed",
                    "manifest_id": request.manifest_id,
                    "reason": reason,
                    "errors": errors or [],
                })
            except Exception:  # marker emission must not mask the original failure
                _log.exception("failed to emit LWG-failure telemetry marker")

        try:
            import json as _json
            from graph.builder import GraphBuilder
            from agents.graph_agent import GraphAgent
            from provenance.graph_to_indicium import graph_to_claims
            from provenance.astra_emit import (
                emit_astra, baseline_universe, nest_universe, write_astra_yaml,
                write_universe_yaml,
            )
            from provenance.universes import pedagogical_decisions, remedial_universe
            from learning_workflow_schema import validate_graph

            lesson_plan.source_manifest_id = lesson_plan.source_manifest_id or request.manifest_id
            _persp = _get_perspicacite_client()  # may be None — grounding falls back to the plan
            _builder = GraphBuilder(
                graph_agent=GraphAgent(),
                perspicacite=_persp,
                course_kb=f"studium-course-{request.manifest_id}",
                asserted_by=f"urn:studium:graphagent:{request.manifest_id}",
            )
            _res = _builder.build(lesson_plan)

            # VALIDATE before attaching/serializing — out-of-vocab or structurally
            # broken graphs must NOT be attached to the plan nor written to disk
            # (otherwise they detonate downstream at bundle-load).
            _validation = validate_graph(_res.graph)
            if not _validation["valid"]:
                _log.error(
                    "LWG build produced an INVALID graph — skipping attach + write: %s",
                    _validation["errors"],
                )
                _emit_lwg_failure("invalid_graph", errors=_validation["errors"])
            else:
                lesson_plan.learning_workflow_graph = _res.graph

                _ped = pedagogical_decisions()
                lesson_plan.universes = {
                    "variants": [baseline_universe(_ped), remedial_universe(_ped)],
                    "active": "baseline",
                }
                # decisions = per-edge agentic decisions (from GraphBuilder) ++ course-level pedagogical decisions
                _analysis = emit_astra(
                    analysis_id=f"{_res.graph['course_id']}-analysis",
                    name=lesson_plan.title,
                    decisions=_res.decisions + _ped,
                    prior_insights=[],
                    findings=_res.findings,
                    outputs=[{"id": "lwg", "type": "data"}],
                )
                os.makedirs(_out_dir, exist_ok=True)
                with open(os.path.join(_out_dir, "lwg.indicium.jsonld"), "w", encoding="utf-8") as _f:
                    _json.dump(graph_to_claims(_res.graph, asserted_by=_builder.asserted_by), _f,
                               ensure_ascii=False, indent=2)
                # Persist the RAW internal LWG graph too. graph_to_claims drops the
                # edge-level quality_flags + confidence (the indicium Claim is
                # extra=forbid), so they are lost from lwg.indicium.jsonld. The raw
                # graph is NOT indicium-constrained, so a teacher reviewing the course
                # for HITL approval can still see which edges are flagged_for_review /
                # ungrounded / low-confidence (build_course_audit_report reads this).
                with open(os.path.join(_out_dir, "lwg.graph.json"), "w", encoding="utf-8") as _f:
                    _json.dump(_res.graph, _f, ensure_ascii=False, indent=2)
                write_astra_yaml(_analysis, _out_dir)
                _slug = next(iter(_analysis["analyses"]))
                write_universe_yaml(nest_universe(baseline_universe(_ped), _slug), _out_dir)
                write_universe_yaml(nest_universe(remedial_universe(_ped), _slug), _out_dir)
                from provenance.exploration_trace import build_exploration_tree, write_exploration_trace
                write_exploration_trace(build_exploration_tree(_analysis), _out_dir)
                _log.info(
                    "LWG built: %d nodes, %d edges -> %s",
                    len(_res.graph["nodes"]), len(_res.graph["edges"]), _out_dir,
                )
        except Exception:
            # Best-effort: a failed LWG build must NOT 500 the /plan response — but
            # make it LOUD (logged ERROR + telemetry marker), never a silent swallow.
            _log.exception("LWG build failed — skipping artifact write")
            _emit_lwg_failure("exception")

    if os.getenv("STUDIUM_EVIDENCE_ENRICH") == "on":
        perspicacite = _get_perspicacite_client()
        abs_reader = _get_abs_reader()
        if perspicacite is not None:
            import logging as _logging
            kb = perspicacite.ensure_course_kb(
                course_id=request.manifest_id,
                corpus_refs=[r.model_dump() for r in request.corpus_refs],
                keywords=request.keywords,
            )
            _logging.getLogger(__name__).info(
                "course KB %s: %s", kb.get("kb_name"), kb.get("status")
            )
            lesson_plan.source_manifest_id = request.manifest_id
            enricher = EvidenceEnricher(
                perspicacite_client=perspicacite,
                abs_reader=abs_reader,
                domain_kb=os.getenv("PERSPICACITE_DOMAIN_KB", ""),
                course_kb_ready=(kb.get("status") == "ready"),
            )
            lesson_plan = enricher.enrich(lesson_plan)

    return PlanResponse(
        lesson_plan=lesson_plan,
        critic_score=critique.score,
        critic_annotations=critique.annotations,
    )
