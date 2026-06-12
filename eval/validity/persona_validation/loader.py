"""loader.py — parse an eval run's persona sessions into PersonaRecords.

A run dir has the shape::

    <run_dir>/sessions/<persona>/driver_result.json
    <run_dir>/sessions/<persona>/telemetry.jsonl

``load_run`` reads each ``driver_result.json`` and collects the ``rule_id`` set
from ``adaptation_applied`` telemetry events. It is intentionally DEFENSIVE:
missing files or fields fall back to sensible defaults and never crash — a
validity tool that dies on a malformed run is useless.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Dict, List, Set


@dataclass
class PersonaRecord:
    """Normalized per-persona signature extracted from a session dir."""

    persona: str
    completed: bool
    n_turns: int
    transition_kinds: List[str]
    transition_counts: Dict[str, int]
    mastery: Dict[str, float]  # concept_id -> alpha/(alpha+beta) in [0,1]
    autonomy_ratio: float
    rules_fired: Set[str] = field(default_factory=set)
    calibration: Dict[str, float] = field(default_factory=dict)  # concept_id -> confidence_calibration in [-1,1]


def _safe_load_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _count(items: List[str]) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for it in items:
        counts[it] = counts.get(it, 0) + 1
    return counts


def _mastery_from_concept_states(concept_states: dict) -> Dict[str, float]:
    """Derive concept -> alpha/(alpha+beta) from final_state.concept_states.

    Falls back gracefully when alpha/beta are missing or sum to zero.
    """
    out: Dict[str, float] = {}
    if not isinstance(concept_states, dict):
        return out
    for cid, st in concept_states.items():
        if not isinstance(st, dict):
            continue
        try:
            alpha = float(st.get("alpha", 0.0))
            beta = float(st.get("beta", 0.0))
        except (TypeError, ValueError):
            continue
        denom = alpha + beta
        out[str(cid)] = (alpha / denom) if denom > 0 else 0.0
    return out


def _calibration_from_concept_states(concept_states: dict) -> Dict[str, float]:
    """Extract concept -> confidence_calibration ([-1,1]) from concept_states.

    confidence_calibration is the axis overconfident/struggling diverge on (same
    answers, different declared confidence) — so collapse detection must weigh it,
    else two behaviourally-identical-but-differently-calibrated personas false-flag.
    """
    out: Dict[str, float] = {}
    if not isinstance(concept_states, dict):
        return out
    for cid, st in concept_states.items():
        if not isinstance(st, dict) or "confidence_calibration" not in st:
            continue
        try:
            out[str(cid)] = float(st.get("confidence_calibration", 0.0))
        except (TypeError, ValueError):
            continue
    return out


def _collect_rules_fired(telemetry_path: str) -> Set[str]:
    """Collect rule_id values from adaptation_applied events in telemetry.jsonl."""
    rules: Set[str] = set()
    if not os.path.isfile(telemetry_path):
        return rules
    try:
        with open(telemetry_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue  # tolerate a corrupt line
                if not isinstance(obj, dict):
                    continue
                event = obj.get("type") or obj.get("event")
                rid = obj.get("rule_id")
                if rid and (event == "adaptation_applied" or rid):
                    rules.add(str(rid))
    except OSError:
        return rules
    return rules


def _record_from_session(session_dir: str, persona: str) -> PersonaRecord:
    driver = _safe_load_json(os.path.join(session_dir, "driver_result.json")) or {}

    persona_name = str(driver.get("persona") or persona)
    completed = bool(driver.get("completed", False))
    try:
        n_turns = int(driver.get("n_turns", 0) or 0)
    except (TypeError, ValueError):
        n_turns = 0

    transition_kinds = driver.get("transition_kinds") or []
    if not isinstance(transition_kinds, list):
        transition_kinds = []
    transition_kinds = [str(t) for t in transition_kinds]

    # mastery: prefer derived alpha/beta (the authoritative state); fall back to
    # final_concept_mastery if concept_states is absent.
    final_state = driver.get("final_state") or {}
    mastery = _mastery_from_concept_states(final_state.get("concept_states") or {})
    if not mastery:
        fcm = driver.get("final_concept_mastery") or {}
        if isinstance(fcm, dict):
            for cid, v in fcm.items():
                try:
                    mastery[str(cid)] = float(v)
                except (TypeError, ValueError):
                    continue

    summary = driver.get("summary") or {}
    try:
        autonomy_ratio = float(summary.get("autonomyRatio", 0.0) or 0.0)
    except (TypeError, ValueError):
        autonomy_ratio = 0.0

    rules_fired = _collect_rules_fired(os.path.join(session_dir, "telemetry.jsonl"))
    calibration = _calibration_from_concept_states(final_state.get("concept_states") or {})

    return PersonaRecord(
        persona=persona_name,
        completed=completed,
        n_turns=n_turns,
        transition_kinds=transition_kinds,
        transition_counts=_count(transition_kinds),
        mastery=mastery,
        autonomy_ratio=autonomy_ratio,
        rules_fired=rules_fired,
        calibration=calibration,
    )


def load_run(run_dir: str) -> Dict[str, PersonaRecord]:
    """Load every persona session under ``<run_dir>/sessions/*``.

    Returns ``{persona -> PersonaRecord}``. A missing run dir or sessions dir
    yields an empty mapping (defensive — never raises on a malformed run).
    """
    sessions_dir = os.path.join(run_dir, "sessions")
    if not os.path.isdir(sessions_dir):
        return {}

    records: Dict[str, PersonaRecord] = {}
    for name in sorted(os.listdir(sessions_dir)):
        session_dir = os.path.join(sessions_dir, name)
        if not os.path.isdir(session_dir):
            continue
        if not os.path.isfile(os.path.join(session_dir, "driver_result.json")):
            continue
        rec = _record_from_session(session_dir, name)
        records[name] = rec
    return records
