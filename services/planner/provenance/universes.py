"""Pedagogical decision space + authored universes (ASTRA Layer-3). These course-config
decisions are independent of the per-edge decisions GraphBuilder emits: a Universe is a
complete option selection across them. v1 ships baseline + remedial; accelerated is a
trivial follow-up (its own option selection)."""
from __future__ import annotations
from typing import Any

from agentic.decision import make_decision

# Each remedial override names the supportive option; absent => keep the default.
_REMEDIAL_OVERRIDES = {"prereq_strictness": "lenient", "scaffolding": "heavy"}


def pedagogical_decisions() -> list[dict[str, Any]]:
    return [
        make_decision(
            decision_id="prereq_strictness", label="Prerequisite gating strictness",
            rationale="How firmly a node is locked until prerequisites are mastered (M1/M6).",
            options=[{"id": "standard", "label": "Standard threshold"},
                     {"id": "lenient", "label": "Lower threshold, earlier unlock"}],
            default="standard"),
        make_decision(
            decision_id="scaffolding", label="Scaffolding level",
            rationale="Amount of guided support, hints, and worked steps (M5 anti-offloading).",
            options=[{"id": "standard", "label": "Standard scaffolding"},
                     {"id": "heavy", "label": "Heavy scaffolding"}],
            default="standard"),
        make_decision(
            decision_id="pacing", label="Pacing",
            rationale="Whether mastered concepts are skipped to accelerate (M1).",
            options=[{"id": "standard", "label": "Standard pacing"},
                     {"id": "skip_on_mastery", "label": "Skip mastered concepts"}],
            default="standard"),
    ]


def remedial_universe(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": "remedial",
        "description": "Supportive path: lower prerequisite threshold + heavier scaffolding.",
        "decisions": {d["id"]: _REMEDIAL_OVERRIDES.get(d["id"], d["default"]) for d in decisions},
    }
