"""Shared fixture synthesis for persona_validation tests.

Mirrors the real eval run shape:
    <run_dir>/sessions/<persona>/driver_result.json
    <run_dir>/sessions/<persona>/telemetry.jsonl

driver_result.json carries: persona, completed, n_turns, transition_kinds,
summary{autonomyRatio, scenesCompleted, totalDurationMs}, final_concept_mastery,
final_state{concept_states{cid:{alpha,beta,total_attempts}}}, transcript.
telemetry.jsonl has one JSON object per line; adaptation_applied events carry
`rule_id`.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Optional


def write_persona(
    run_dir: str,
    persona: str,
    *,
    completed: bool = True,
    n_turns: int = 15,
    transition_kinds: Optional[List[str]] = None,
    mastery: Optional[Dict[str, float]] = None,
    autonomy_ratio: float = 1.0,
    rules_fired: Optional[List[str]] = None,
    scenes_completed: int = 15,
    total_duration_ms: int = 10,
) -> str:
    """Write a synthetic session dir for one persona. Returns the session dir."""
    transition_kinds = transition_kinds if transition_kinds is not None else ["next", "complete"]
    mastery = mastery if mastery is not None else {"c-a": 0.8, "c-b": 0.8}
    rules_fired = rules_fired if rules_fired is not None else []

    sess = os.path.join(run_dir, "sessions", persona)
    os.makedirs(sess, exist_ok=True)

    # concept_states: derive alpha/beta so that alpha/(alpha+beta) == mastery
    concept_states = {}
    for cid, m in mastery.items():
        # pick a small total and back out alpha/beta on a [1..] scale
        total = 10.0
        alpha = round(m * total, 6)
        beta = round((1.0 - m) * total, 6)
        concept_states[cid] = {
            "concept_id": cid,
            "alpha": alpha,
            "beta": beta,
            "total_attempts": 5,
            "total_correct": int(round(m * 5)),
        }

    driver_result = {
        "persona": persona,
        "completed": completed,
        "n_turns": n_turns,
        "transition_kinds": transition_kinds,
        "summary": {
            "totalDurationMs": total_duration_ms,
            "autonomyRatio": autonomy_ratio,
            "scenesCompleted": scenes_completed,
        },
        "final_concept_mastery": dict(mastery),
        "final_state": {"concept_states": concept_states},
        "transcript": [],
    }
    with open(os.path.join(sess, "driver_result.json"), "w", encoding="utf-8") as fh:
        json.dump(driver_result, fh)

    # telemetry.jsonl — a couple of non-adaptation lines + adaptation_applied lines
    lines = [
        {"type": "universe_selected", "universe_id": "baseline"},
        {"type": "lesson_started"},
    ]
    for rid in rules_fired:
        lines.append({"type": "adaptation_applied", "rule_id": rid, "signal": "x"})
    lines.append({"type": "lesson_completed"})
    with open(os.path.join(sess, "telemetry.jsonl"), "w", encoding="utf-8") as fh:
        for o in lines:
            fh.write(json.dumps(o) + "\n")

    return sess


def write_run(run_dir: str, personas: Dict[str, dict]) -> str:
    """personas: {persona_name: kwargs-for-write_persona}. Returns run_dir."""
    for name, kwargs in personas.items():
        write_persona(run_dir, name, **kwargs)
    return run_dir
