"""Critic agent — scores a LessonPlan before human review (rule 003).

Calls LLMClient (studium/critic alias) and validates the structured output.
"""
from __future__ import annotations
import json
import logging
import os
import time
from typing import Any

from planner_schemas import LessonPlan

_LOG = logging.getLogger(__name__)
_LLM_MODE = os.environ.get("STUDIUM_LLM_MODE", "mock")
_LITELLM_BASE = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
_LITELLM_KEY = os.environ.get("LITELLM_API_KEY", "")
_LIVE_MODE = "litellm"
_CRITIC_ALIAS = "studium/critic"
_LLM_TIMEOUT_S = 30.0


def _call_critic_llm(prompt: str) -> str:
    """Return the critic verdict as raw JSON text.

    Input: the critic prompt. Output: the model's JSON reply. In live mode the mock is
    NEVER a fallback — a failed call raises so the caller's retry loop ends in an error
    instead of a fabricated green verdict.
    """
    if _LLM_MODE == _LIVE_MODE:
        return _post_to_litellm(prompt)
    return _mock_critic_response()


def _post_to_litellm(prompt: str) -> str:
    """Post the prompt to the LiteLLM gateway.

    Input: the critic prompt. Output: the assistant message content. Logs and re-raises
    any transport/HTTP/decoding failure (missing key, 401, 429, timeout).
    """
    import httpx
    try:
        resp = httpx.post(
            f"{_LITELLM_BASE}/v1/chat/completions",
            json={"model": _CRITIC_ALIAS, "messages": [{"role": "user", "content": prompt}]},
            headers={"Authorization": f"Bearer {_LITELLM_KEY}"} if _LITELLM_KEY else {},
            timeout=_LLM_TIMEOUT_S,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:
        _LOG.exception("critic LLM call failed (mode=%s, base=%s)", _LLM_MODE, _LITELLM_BASE)
        raise


def _mock_critic_response() -> str:
    """Return the canned offline verdict, stamped is_mock so no consumer reads it as live."""
    return json.dumps({
        "score": 0.78,
        "is_mock": True,
        "annotations": [
            "Le plan couvre bien les objectifs de niveau understand.",
            # 'reproduction', pas 'simulation' : les deux couvrent l'apply pour le critic, mais
            # scene-synth n'a pas d'agent 'simulation' et le vocabulaire de bundle n'a pas de
            # membre 'simulation' — un enseignant qui suivait ce conseil obtenait une scène
            # silencieusement abandonnée à la synthèse. Voir scene-synth
            # KNOWN_UNSUPPORTED_SCENE_TYPES.
            "Suggérer d'ajouter une scène 'reproduction' pour renforcer l'apply.",
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
    """Score a LessonPlan. Returns {score: float, annotations: list[str], is_mock: bool}.

    is_mock is True when the verdict came from the offline canned response rather than a
    live model. Does NOT mutate the plan (rule 003 — human must validate).
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
            return {
                "score": score,
                "annotations": annotations,
                "is_mock": bool(data.get("is_mock", False)),
            }
        except Exception as exc:
            last_exc = exc
            continue

    raise ValueError(
        f"critic: failed after 3 attempts. Last error: {last_exc}\nLast raw: {raw!r}"
    )
