"""The one wrapper every agentic step routes through. Composes WITH agents/base.py
BaseAgent (which owns the schema-constrained LLM call + retry): this kernel takes the
agent's already-validated `candidate` output and adds admission + ASTRA provenance +
telemetry. Returns the validated output, the admission verdict, and the ASTRA
Decision (+ optional Insight finding)."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional

from .admission import admit, AdmissionResult, HeuristicFn, LlmJudgeFn
from .decision import make_decision


@dataclass
class AgenticStepResult:
    output: dict[str, Any]
    admission: AdmissionResult
    decision: dict[str, Any]
    insight: Optional[dict[str, Any]] = None
    quality_flags: list[str] = field(default_factory=list)


def run_agentic_step(
    *,
    step_id: str,
    label: str,
    rationale: str,
    options: list[dict[str, Any]],
    chosen_option_id: str,
    candidate: dict[str, Any],
    heuristic: HeuristicFn,
    telemetry: Any,                       # TelemetrySinkPort: .emit(dict)
    created_at: str,
    llm_judge: Optional[LlmJudgeFn] = None,
    rescue_budget: Optional[list[int]] = None,
    insight: Optional[dict[str, Any]] = None,
    strict: bool = False,
) -> AgenticStepResult:
    result = admit(candidate, heuristic=heuristic, llm_judge=llm_judge,
                   rescue_budget=rescue_budget, strict=strict)
    decision = make_decision(decision_id=step_id, label=label, rationale=rationale,
                             options=options, default=chosen_option_id)
    # propagate admission reasons as quality flags only when the step is non-clean
    quality_flags = result.reasons if (result.flagged_for_review or not result.admitted) else []
    telemetry.emit({
        "ts": created_at,
        "step_id": step_id,
        "event": "agentic_step",
        "admitted": result.admitted,
        "path": result.path,
        "score": result.score,
        "tier": result.tier,
        "flagged_for_review": result.flagged_for_review,
        "quality_flags": quality_flags,
        "chosen_option_id": chosen_option_id,
    })
    return AgenticStepResult(output=candidate, admission=result, decision=decision,
                             insight=insight, quality_flags=quality_flags)
