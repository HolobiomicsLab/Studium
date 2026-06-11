"""GraphBuilder: assembles a Learning Workflow Graph (Mode A, document-first) from a
LessonPlan. Deterministic backbone (derive_base_graph) + LLM-proposed prerequisite_for
edges, each routed through the agentic-step contract (admission + ASTRA Decision/Insight
+ telemetry), grounded by Perspicacité passages with a plan-artifact fallback, and
DAG-enforced. Fully dependency-injected; structurally-invalid proposals are dropped
(logged), weakly-grounded ones are kept with quality_flags."""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from agentic.step import run_agentic_step
from agentic.decision import make_insight, make_evidence
from agentic.telemetry import InMemoryTelemetrySink
from graph.derive import derive_base_graph
from graph.cycle import would_create_cycle

_EXCERPT_MAX = 500


def _default_clock() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class GraphBuildResult:
    graph: dict[str, Any]
    decisions: list[dict[str, Any]]
    findings: list[dict[str, Any]]
    telemetry: list[dict[str, Any]] = field(default_factory=list)


class GraphBuilder:
    def __init__(
        self,
        *,
        graph_agent: Any,
        perspicacite: Optional[Any] = None,
        telemetry: Optional[Any] = None,
        clock: Optional[Callable[[], str]] = None,
        asserted_by: str = "urn:studium:graphagent:run",
        course_kb: str = "",
    ) -> None:
        self._agent = graph_agent
        self._persp = perspicacite
        self._telemetry = telemetry if telemetry is not None else InMemoryTelemetrySink()
        self._clock = clock or _default_clock
        self.asserted_by = asserted_by
        self._course_kb = course_kb

    def build(self, plan: Any) -> GraphBuildResult:
        course_id = plan.source_manifest_id or plan.id
        analysis_id = f"{course_id}-analysis"
        nodes, base_edges = derive_base_graph(plan)
        concepts = [n for n in nodes if n["node_kind"] == "concept"]
        concept_ids = {c["id"] for c in concepts}
        concept_title = {c["id"]: c.get("title", "") for c in concepts}

        proposed = self._agent.propose_prerequisites(concepts)
        prereq_edges: list[dict[str, Any]] = []
        decisions: list[dict[str, Any]] = []
        findings: list[dict[str, Any]] = []
        created_at = self._clock()

        for idx, pe in enumerate(proposed):
            src = pe.get("source")
            tgt = pe.get("target")
            edge_id = f"prereq{idx}"
            if src not in concept_ids or tgt not in concept_ids:
                self._telemetry.emit({"ts": created_at, "event": "dropped_edge",
                                      "reason": "unknown_endpoint", "source": src, "target": tgt})
                continue
            if src == tgt:
                self._telemetry.emit({"ts": created_at, "event": "dropped_edge",
                                      "reason": "self_loop", "source": src, "target": tgt})
                continue
            if would_create_cycle(prereq_edges, src, tgt):
                self._telemetry.emit({"ts": created_at, "event": "dropped_edge",
                                      "reason": "cycle", "source": src, "target": tgt})
                continue

            flat_ev, astra_ev, grounded = self._ground(plan, src, tgt, concept_title)

            def _heuristic(_c: dict, _grounded: bool = grounded) -> tuple[float, list[str]]:
                return (1.0, []) if _grounded else (0.5, ["no supporting passage"])

            insight = make_insight(
                insight_id=edge_id,
                claim=f"{concept_title.get(src, src)} requires {concept_title.get(tgt, tgt)}",
                created_at=created_at,
                evidence=[astra_ev],
            )
            result = run_agentic_step(
                step_id=edge_id,
                label=f"Is {tgt} a prerequisite of {src}?",
                rationale=str(pe.get("rationale", "")),
                options=[{"id": "include", "label": "Include"}, {"id": "omit", "label": "Omit"}],
                chosen_option_id="include",
                candidate={"source": src, "target": tgt},
                heuristic=_heuristic,
                telemetry=self._telemetry,
                created_at=created_at,
                insight=insight,
            )
            edge: dict[str, Any] = {
                "id": edge_id,
                "relation": "prerequisite_for",
                "source": src,
                "target": tgt,
                "confidence": flat_ev.get("confidence"),
                "evidence": [flat_ev],
                "astra_insight_ref": f"{analysis_id}/{edge_id}",
            }
            if result.quality_flags:
                edge["quality_flags"] = result.quality_flags
            prereq_edges.append(edge)
            decisions.append(result.decision)
            if result.insight is not None:
                findings.append(result.insight)

        graph = {
            "schema_version": "1.0",
            "course_id": course_id,
            "nodes": nodes,
            "edges": base_edges + prereq_edges,
        }
        records = getattr(self._telemetry, "records", [])
        return GraphBuildResult(graph=graph, decisions=decisions, findings=findings,
                                telemetry=list(records))

    def _ground(self, plan: Any, src: str, tgt: str, titles: dict[str, str]
                ) -> tuple[dict[str, Any], dict[str, Any], bool]:
        """Return (flat_evidence_for_edge, astra_evidence_for_insight, grounded?)."""
        if self._persp is not None:
            try:
                resp = self._persp.search(
                    query=f"relationship between {titles.get(tgt, tgt)} and {titles.get(src, src)}",
                    mode="passages", max_results=1,
                    kb_names=[self._course_kb] if self._course_kb else None,
                )
                docs = resp.get("docs") if isinstance(resp, dict) else None
                if resp.get("status") == "ok" and docs:
                    d = docs[0]
                    conf = float(d.get("relevance_score") or 0.6)
                    excerpt = (d.get("excerpt") or "")[:_EXCERPT_MAX]
                    if d.get("doi"):
                        flat = {"doi": d["doi"], "quote": excerpt, "confidence": conf}
                        astra = make_evidence(doi=d["doi"], quote=excerpt, confidence=conf)
                    else:
                        ref = f"perspicacite:{d.get('id', 'doc')}"
                        flat = {"artifact": ref, "quote": excerpt, "confidence": conf}
                        astra = make_evidence(artifact=ref, quote=excerpt, confidence=conf)
                    return flat, astra, True
            except Exception:
                pass
        ref = f"plan:{plan.id}#objectives"
        flat = {"artifact": ref, "confidence": 0.4}
        astra = make_evidence(artifact=ref, confidence=0.4)
        return flat, astra, False
