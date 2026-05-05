"""Planner wrapper — LLMClient direct fallback (ADR 008, Mimosa SDK absent).

Interface stable : generate(corpus_manifest, target) → LessonPlan
Swap vers Mimosa SDK en M2/M3 sans modifier les consommateurs.
"""
from __future__ import annotations
import json
import os
import time
import uuid
from typing import Any

from schemas import LessonPlan, LearningObjective, SceneOutline, CorpusRef, PlanStatus

_LAST_AUDIT: dict[str, Any] | None = None
_LLM_MODE = os.environ.get("STUDIUM_LLM_MODE", "mock")  # "mock" | "litellm"
_LITELLM_BASE = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
_LITELLM_KEY = os.environ.get("LITELLM_API_KEY", "")


def get_last_audit() -> dict[str, Any] | None:
    return _LAST_AUDIT


def _call_llm(prompt: str, alias: str = "studium/planner") -> str:
    """Call LLM in mock or LiteLLM mode."""
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
        except Exception as exc:
            return _mock_response(alias, prompt, reason=str(exc))
    return _mock_response(alias, prompt)


def _mock_response(alias: str, prompt: str, reason: str = "") -> str:
    """Deterministic mock plan — used in tests and when LiteLLM unavailable."""
    _ = prompt  # consumed only in real mode
    return json.dumps({
        "schema_version": "1.0",
        "id": f"plan-{uuid.uuid4().hex[:8]}",
        "title": "Introduction à la métabolomique (plan généré)",
        "language": "fr",
        "target": "L3",
        "duration_minutes": 45,
        "learning_objectives": [
            {"id": "obj-1", "description": "Comprendre les fondements de la métabolomique", "bloom_level": "understand"},
            {"id": "obj-2", "description": "Appliquer les techniques d'analyse", "bloom_level": "apply"},
        ],
        "scene_outlines": [
            {"id": "sc-1", "type": "intro", "title": "Introduction au domaine", "objective_refs": ["obj-1"]},
            {"id": "sc-2", "type": "concept", "title": "Méthodes analytiques", "objective_refs": ["obj-1", "obj-2"]},
            {"id": "sc-3", "type": "quiz", "title": "Vérification des acquis", "objective_refs": ["obj-2"]},
        ],
        "corpus_refs": [],
        "status": "draft",
        "metadata": {
            "subject": "Métabolomique",
            "author": "system",
            "created": time.strftime("%Y-%m-%d"),
            "tags": ["mock" if not reason else "mock-fallback"],
        },
    })


def _build_prompt(corpus_manifest: dict[str, Any], target: str) -> str:
    refs_summary = ", ".join(
        r.get("doi") or r.get("ref_id", "?")
        for r in corpus_manifest.get("corpus_refs", [])[:5]
    )
    preview = (corpus_manifest.get("text_preview") or "")[:300]
    return (
        f"Génère un plan pédagogique structuré pour un cours de niveau {target}.\n"
        f"Durée : {corpus_manifest.get('duration_minutes', 45)} minutes.\n"
        f"Références corpus : {refs_summary or 'aucune'}.\n"
        f"Extrait du corpus : {preview}\n"
        f"Retourne uniquement un objet JSON conforme au schéma lesson-plan-schema v1."
    )


def generate(corpus_manifest: dict[str, Any], target: str) -> LessonPlan:
    """Generate a lesson plan from a corpus manifest.

    Validates output with Pydantic (rule 002). Retries up to 2 times if parse fails.
    Records audit trace accessible via get_last_audit().
    """
    global _LAST_AUDIT
    alias = "studium/planner"
    prompt = _build_prompt(corpus_manifest, target)
    t0 = time.monotonic()
    raw: str | None = None
    last_exc: Exception | None = None

    for attempt in range(3):
        try:
            raw = _call_llm(prompt, alias)
            data = json.loads(raw)
            # Inject target from request (overrides LLM value for safety)
            data["target"] = target
            # Inject corpus refs from manifest if LLM omitted them
            if not data.get("corpus_refs"):
                data["corpus_refs"] = corpus_manifest.get("corpus_refs", [])
            plan = LessonPlan(**data)
            latency = time.monotonic() - t0
            _LAST_AUDIT = {
                "provider": _LLM_MODE,
                "alias": alias,
                "latency_s": round(latency, 3),
                "attempt": attempt + 1,
                "status": "ok",
            }
            return plan
        except Exception as exc:
            last_exc = exc
            continue

    # All attempts failed — record audit and raise
    _LAST_AUDIT = {
        "provider": _LLM_MODE,
        "alias": alias,
        "latency_s": round(time.monotonic() - t0, 3),
        "attempt": 3,
        "status": "error",
        "error": str(last_exc),
    }
    raise ValueError(f"mimosa_wrapper: failed after 3 attempts. Last error: {last_exc}\nLast raw: {raw!r}")
