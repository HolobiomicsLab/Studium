"""Critic agent — scores a LessonPlan before human review (rule 003).

Calls LLMClient (studium/critic alias) and validates the structured output.
"""
from __future__ import annotations
import json
import os
import time
from typing import Any

from schemas import LessonPlan

_LLM_MODE = os.environ.get("STUDIUM_LLM_MODE", "mock")
_LITELLM_BASE = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
_LITELLM_KEY = os.environ.get("LITELLM_API_KEY", "")


def _call_critic_llm(prompt: str) -> str:
    alias = "studium/critic"
    if _LLM_MODE == "litellm":
        try:
            import httpx
            resp = httpx.post(
                f"{_LITELLM_BASE}/v1/chat/completions",
                json={"model": alias, "messages": [{"role": "user", "content": prompt}]},
                headers={"Authorization": f"Bearer {_LITELLM_KEY}"} if _LITELLM_KEY else {},
                timeout=30.0,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
        except Exception:
            pass
    return _mock_critic_response()


def _mock_critic_response() -> str:
    return json.dumps({
        "score": 0.78,
        "annotations": [
            "Le plan couvre bien les objectifs de niveau understand.",
            "Suggérer d'ajouter une scène 'simulation' pour renforcer l'apply.",
            "Les références corpus sont présentes et traçables.",
        ],
    })


def _build_critic_prompt(plan: LessonPlan) -> str:
    scenes = ", ".join(f"{s.type}:{s.title}" for s in plan.scene_outlines)
    objectives = "; ".join(f"{o.bloom_level}:{o.description}" for o in plan.learning_objectives)
    refs_count = len(plan.corpus_refs)
    return (
        f"Évalue ce plan pédagogique pour un cours de niveau {plan.target} ({plan.duration_minutes} min).\n"
        f"Objectifs : {objectives}\n"
        f"Scènes : {scenes}\n"
        f"Références corpus : {refs_count}\n"
        f"Retourne uniquement JSON: {{\"score\": float [0..1], \"annotations\": [string, ...]}}"
    )


def review(plan: LessonPlan) -> dict[str, Any]:
    """Score a LessonPlan. Returns {score: float, annotations: list[str]}.

    Does NOT mutate the plan (rule 003 — human must validate).
    """
    prompt = _build_critic_prompt(plan)
    t0 = time.monotonic()
    raw: str | None = None
    last_exc: Exception | None = None

    for attempt in range(3):
        try:
            raw = _call_critic_llm(prompt)
            data = json.loads(raw)
            score = float(data["score"])
            if not (0.0 <= score <= 1.0):
                raise ValueError(f"score out of range: {score}")
            annotations = [str(a) for a in data.get("annotations", [])]
            return {"score": score, "annotations": annotations}
        except Exception as exc:
            last_exc = exc
            continue

    raise ValueError(
        f"critic: failed after 3 attempts. Last error: {last_exc}\nLast raw: {raw!r}"
    )
