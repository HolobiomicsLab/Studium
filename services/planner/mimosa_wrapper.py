"""Thin wrapper de compatibilité — délègue à PlannerAgent (ADR 008, M2).

Interface conservée pour les tests M1 existants.
"""
from __future__ import annotations
from typing import Any

from agents.planner_agent import PlannerAgent
from lesson_plan_schema import LessonPlan

_agent = PlannerAgent()


def generate(corpus_manifest: dict[str, Any], target: str) -> LessonPlan:
    """Génère un LessonPlan. Conservé pour compatibilité avec les tests M1."""
    plan, _ = _agent.generate(corpus_manifest, target=target)
    return plan


def get_last_audit() -> dict[str, Any] | None:
    """Retourne le dernier audit trace (compatibilité M1)."""
    return getattr(_agent, "_last_audit", None)
