"""FastAPI app for the scene-synth service (A.7).

Exposes:
- ``GET  /health`` — liveness probe.
- ``POST /scenes/synthesize`` — orchestrates the six SceneAgents and
  returns a ``LessonBundle`` ZIP URI.
- ``POST /scenes/critique-eval`` — scores a student critique against a
  set of claims + rubric (anti-offloading; cf. ADR 001/004).

Singletons ``_orchestrator`` and ``_critique_evaluator`` are module-level
so tests can override them via ``monkeypatch.setattr``. The default
factory ``_build_default_orchestrator`` returns ``None`` unless the
``ABS_CAPSULE_ROOT`` env var is set, so the app boots in test contexts
without a real LLM.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException

from agents.base import SceneSynthError
from agents.critique_evaluator import CritiqueEvaluator
from orchestrator import SceneSynthOrchestrator
from scene_synth_schemas import (
    CritiqueEvalRequest,
    CritiqueEvalResponse,
    SynthesizeRequest,
    SynthesizeResponse,
)


app = FastAPI(title="scene-synth", version="0.1.0")


# Module-level singletons — overridable in tests via monkeypatch.
_orchestrator: Optional[SceneSynthOrchestrator] = None
_critique_evaluator: Optional[CritiqueEvaluator] = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scenes/synthesize", response_model=SynthesizeResponse)
def synthesize(req: SynthesizeRequest) -> SynthesizeResponse:
    if _orchestrator is None:
        raise HTTPException(
            status_code=503, detail="orchestrator not configured"
        )
    options = req.options.model_dump() if req.options else {}
    try:
        result = _orchestrator.synthesize_lesson(
            lesson_plan=req.lesson_plan,
            options=options,
        )
    except SceneSynthError as e:
        raise HTTPException(
            status_code=502, detail=f"LLM call failed: {e}"
        )
    return SynthesizeResponse(**result)


@app.post("/scenes/critique-eval", response_model=CritiqueEvalResponse)
def critique_eval(req: CritiqueEvalRequest) -> CritiqueEvalResponse:
    if _critique_evaluator is None:
        raise HTTPException(
            status_code=503, detail="critique evaluator not configured"
        )
    result = _critique_evaluator.evaluate(
        claims=[c.model_dump() for c in req.claims],
        rubric=req.rubric.model_dump(),
        student_critique=req.student_critique,
    )
    return CritiqueEvalResponse(score=result.score, feedback=result.feedback)


__all__ = ["app"]
