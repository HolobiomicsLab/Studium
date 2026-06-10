"""ASB-grade admission gate. Lenient by default: borderline outputs are KEPT with
quality_flags (flagged_for_review) rather than dropped — they feed the HITL queue.
strict=True restores drop semantics."""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable, Literal, Optional

HeuristicFn = Callable[[dict], tuple[float, list[str]]]   # candidate -> (score 0..1, reasons)
LlmJudgeFn = Callable[[dict], tuple[bool, Optional[str]]]  # candidate -> (admit?, reason)

Path = Literal["heuristic", "semantic_high", "llm_judge", "llm_rescue", "fallback"]
Tier = Literal["pass", "rescue", "fail"]


@dataclass
class AdmissionResult:
    admitted: bool
    reasons: list[str] = field(default_factory=list)
    path: Path = "heuristic"
    score: float = 1.0
    tier: Tier = "pass"
    flagged_for_review: bool = False


def admit(
    candidate: dict,
    *,
    heuristic: HeuristicFn,
    pass_threshold: float = 0.6,
    rescue_threshold: float = 0.4,
    llm_judge: Optional[LlmJudgeFn] = None,
    rescue_budget: Optional[list[int]] = None,  # 1-element mutable counter; None = unlimited
    strict: bool = False,
) -> AdmissionResult:
    score, reasons = heuristic(candidate)
    if score >= pass_threshold:
        return AdmissionResult(admitted=True, score=score, path="heuristic", tier="pass")

    budget_ok = rescue_budget is None or rescue_budget[0] > 0
    if llm_judge is not None and score >= rescue_threshold and budget_ok:
        if rescue_budget is not None:
            rescue_budget[0] -= 1
        ok, reason = llm_judge(candidate)
        extra = [reason] if reason else []
        if ok:
            return AdmissionResult(admitted=True, score=score, path="llm_rescue", tier="rescue", reasons=extra)
        if strict:
            return AdmissionResult(admitted=False, score=score, path="llm_judge", tier="fail", reasons=reasons + extra)
        return AdmissionResult(admitted=True, score=score, path="llm_judge", tier="rescue",
                               reasons=reasons + extra, flagged_for_review=True)

    if strict:
        return AdmissionResult(admitted=False, score=score, path="fallback", tier="fail", reasons=reasons)
    return AdmissionResult(admitted=True, score=score, path="fallback", tier="rescue",
                           reasons=reasons, flagged_for_review=True)
