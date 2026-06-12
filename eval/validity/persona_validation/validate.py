"""validate.py — the persona-validity scorecard (EV-9, internal validity).

``validate_run(run_dir)`` answers ONE question: are this run's simulated-student
personas a TRUSTWORTHY measurement instrument? It checks that they

  1. actually DIVERGE (no "persona collapse" — two near-identical personas make
     whatever they're meant to separate, e.g. M3 calibration, unobservable),
  2. exercise the intended adaptive RUNTIME BRANCHES (so the eval is known to
     touch the adaptive paths it claims to measure), and
  3. all complete (a persona that hits the turn cap is a broken instrument).

It does NOT validate real-vs-simulated fidelity — that needs real student data
and is tracked as future work (EV-9b).
"""

from __future__ import annotations

from itertools import combinations
from typing import Dict, List

from eval.validity.persona_validation.loader import PersonaRecord, load_run
from eval.validity.persona_validation.metrics import (
    COLLAPSE_THRESHOLD,
    collapse_score,
)

# Runtime branches the eval MUST exercise across the persona union for its
# Tier-1 adaptive signal to be meaningful. transition kinds + adaptation rules.
EXPECTED_BRANCHES = frozenset(
    {
        "next",
        "remediate_alt",
        "complete",
        "graph_prereq_gate",
        "graph_universe_escalated",
    }
)

# Branches that may appear but are not required to be present.
OPTIONAL_BRANCHES = frozenset(
    {"replay", "graph_skip_mastered", "skip_mastered", "calibration"}
)

NOTE = (
    "internal-validity only: this confirms the personas diverge, cover the "
    "expected adaptive branches, and complete — i.e. they are a usable "
    "measurement instrument. It does NOT validate real-vs-simulated fidelity "
    "(real-student behaviour); that requires real student data and is tracked "
    "as future work EV-9b."
)


def _mean(xs: List[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _all_concepts(records: Dict[str, PersonaRecord]) -> List[str]:
    concepts = set()
    for rec in records.values():
        concepts.update(rec.mastery.keys())
    return sorted(concepts)


def _signature(rec: PersonaRecord) -> dict:
    return {
        "completed": rec.completed,
        "n_turns": rec.n_turns,
        "mean_mastery": round(_mean(list(rec.mastery.values())), 6),
        "transition_counts": dict(rec.transition_counts),
        "autonomy_ratio": rec.autonomy_ratio,
        "rules_fired": sorted(rec.rules_fired),
    }


def validate_run(run_dir: str) -> dict:
    """Analyze one eval run and return the persona-validity scorecard."""
    records = load_run(run_dir)
    concepts = _all_concepts(records)

    findings: List[dict] = []

    # --- per-persona signatures ---
    personas = {name: _signature(rec) for name, rec in records.items()}

    # --- divergence checks (every persona pair) ---
    pairs: Dict[str, dict] = {}
    for a, b in combinations(sorted(records), 2):
        score = collapse_score(records[a], records[b], concepts)
        key = f"{a}__{b}"
        collapsed = score >= COLLAPSE_THRESHOLD
        pairs[key] = {
            "a": a,
            "b": b,
            "collapse_score": round(score, 6),
            "collapsed": collapsed,
        }
        if collapsed:
            findings.append(
                {
                    "severity": "high",
                    "message": (
                        f"persona collapse: {a} ≈ {b} "
                        f"(collapse_score={score:.3f} ≥ {COLLAPSE_THRESHOLD}); "
                        "near-identical mastery AND transition mix — the eval "
                        "cannot separate them"
                    ),
                }
            )

    # proficient-vs-struggling MUST diverge specifically (different mean_mastery
    # AND different transition mix) — that pair carries the core Tier-1 contrast.
    if "proficient" in records and "struggling" in records:
        p, s = records["proficient"], records["struggling"]
        same_mastery = abs(_mean(list(p.mastery.values())) - _mean(list(s.mastery.values()))) < 1e-9
        same_transitions = p.transition_counts == s.transition_counts
        if same_mastery and same_transitions:
            findings.append(
                {
                    "severity": "high",
                    "message": (
                        "proficient and struggling are indistinguishable "
                        "(identical mean_mastery and transition mix) — the "
                        "core proficient-vs-struggling contrast is unobservable"
                    ),
                }
            )

    divergence = {
        "pairs": pairs,
        "max_collapse_score": round(
            max((p["collapse_score"] for p in pairs.values()), default=0.0), 6
        ),
        "any_collapsed": any(p["collapsed"] for p in pairs.values()),
    }

    # --- branch coverage (union of transition kinds + rules fired) ---
    observed = set()
    for rec in records.values():
        observed.update(rec.transition_kinds)
        observed.update(rec.rules_fired)
    missing = sorted(EXPECTED_BRANCHES - observed)
    if missing:
        findings.append(
            {
                "severity": "high",
                "message": (
                    "missing expected adaptive branch(es) never exercised by any "
                    f"persona: {missing} — the eval does not demonstrably "
                    "touch these paths"
                ),
            }
        )
    branch_coverage = {
        "expected": sorted(EXPECTED_BRANCHES),
        "observed": sorted(observed),
        "missing": missing,
        "optional_seen": sorted(observed & OPTIONAL_BRANCHES),
    }

    # --- all-completed check ---
    incomplete = sorted(name for name, rec in records.items() if not rec.completed)
    if incomplete:
        findings.append(
            {
                "severity": "high",
                "message": (
                    f"persona(s) did not complete (hit the turn cap): {incomplete} "
                    "— a non-completing persona is a broken instrument"
                ),
            }
        )

    # no personas at all is itself a failure
    if not records:
        findings.append(
            {
                "severity": "high",
                "message": "no persona sessions found under <run_dir>/sessions/*",
            }
        )

    verdict = "pass" if not any(f["severity"] == "high" for f in findings) else "flags"

    return {
        "run_dir": run_dir,
        "personas": personas,
        "divergence": divergence,
        "branch_coverage": branch_coverage,
        "incomplete_personas": incomplete,
        "findings": findings,
        "verdict": verdict,
        "note": NOTE,
    }
