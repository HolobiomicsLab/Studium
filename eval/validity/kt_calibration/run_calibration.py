"""run_calibration.py — the KT calibration protocol + CLI (EV-4).

For each model we replay the interaction stream IN ORDER. For every interaction
we PREDICT before seeing the answer, record ``(y, p)``, then UPDATE the model
with the observed outcome. Brier / AUC / accuracy are computed over ALL
predictions. We compare the production Beta learner model against two
references: BKT (fixed params) and a RunningMean floor.

Difficulty ``w`` for the Beta update: KT datasets have no Bloom level, so we
estimate a per-skill difficulty ``w = 1 - p_correct(skill)`` clamped to
``[0.1, 0.9]``. By default this is computed once over the whole stream (a
train-on-all estimate, documented as such); ``--running-difficulty`` switches to
a causal running estimate that uses only past observations.

Usage:
    python run_calibration.py --synth --seed 1
    python run_calibration.py --csv path/to/ednet.csv
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Dict, List, Optional, Tuple

# Allow running as a direct script (`python run_calibration.py`) as well as a
# module (`python -m eval.validity.kt_calibration.run_calibration`): ensure the
# repo root is importable so the `eval.validity...` package path resolves.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from eval.validity.kt_calibration.baselines import BKTModel, RunningMeanModel
from eval.validity.kt_calibration.beta_model import BetaModel
from eval.validity.kt_calibration.metrics import accuracy, auc, brier
from eval.validity.kt_calibration.synth import generate_synthetic

DIFF_CLAMP = (0.1, 0.9)


def estimate_difficulty(interactions: List[Dict]) -> Dict[str, float]:
    """Per-skill difficulty ``w = 1 - p_correct(skill)`` clamped to [0.1, 0.9].

    Computed over the whole stream (a global train estimate). For skills never
    seen the caller falls back to 0.5.
    """
    agg: Dict[str, list] = {}
    for r in interactions:
        s = agg.setdefault(r["skill"], [0, 0])
        s[0] += r["correct"]
        s[1] += 1
    lo, hi = DIFF_CLAMP
    out: Dict[str, float] = {}
    for skill, (correct, n) in agg.items():
        p = correct / n if n else 0.5
        w = 1.0 - p
        out[skill] = min(hi, max(lo, w))
    return out


def replay(
    model,
    interactions: List[Dict],
    difficulty: Optional[Dict[str, float]] = None,
    running_difficulty: bool = False,
) -> Tuple[List[int], List[float]]:
    """Replay interactions: predict-before, record (y, p), update-after.

    Args:
        model: object with ``predict(student, skill)`` and
            ``update(student, skill, correct, w, hints)``.
        interactions: ordered list of {student, skill, correct, order}.
        difficulty: precomputed per-skill w (used when not running_difficulty).
        running_difficulty: if True, estimate w causally from past outcomes
            (skill-level), starting at 0.5 before any data.

    Returns:
        (ys, ps): observed outcomes and the prior predictions.
    """
    difficulty = difficulty or {}
    ys: List[int] = []
    ps: List[float] = []
    # causal running counts per skill for running_difficulty mode
    run_counts: Dict[str, list] = {}
    lo, hi = DIFF_CLAMP

    for r in interactions:
        student, skill, y = r["student"], r["skill"], int(r["correct"])
        p = model.predict(student, skill)
        ys.append(y)
        ps.append(p)

        if running_difficulty:
            c = run_counts.setdefault(skill, [0, 0])
            pc = c[0] / c[1] if c[1] else 0.5
            w = min(hi, max(lo, 1.0 - pc))
            c[0] += y
            c[1] += 1
        else:
            w = difficulty.get(skill, 0.5)

        model.update(student, skill, y, w, 0)
    return ys, ps


def _metrics(ys: List[int], ps: List[float]) -> Dict[str, float]:
    return {
        "brier": brier(ys, ps),
        "auc": auc(ys, ps),
        "accuracy": accuracy(ys, ps),
        "n": len(ys),
    }


def evaluate_models(
    interactions: List[Dict],
    running_difficulty: bool = False,
) -> Dict[str, Dict[str, float]]:
    """Run all three models over the stream and return their metrics."""
    difficulty = estimate_difficulty(interactions)
    results: Dict[str, Dict[str, float]] = {}
    for name, model in (
        ("beta", BetaModel()),
        ("bkt", BKTModel()),
        ("running_mean", RunningMeanModel()),
    ):
        ys, ps = replay(
            model,
            interactions,
            difficulty=difficulty,
            running_difficulty=running_difficulty,
        )
        results[name] = _metrics(ys, ps)
    return results


def _format_table(results: Dict[str, Dict[str, float]]) -> str:
    header = f"{'model':<14}{'Brier↓':>10}{'AUC↑':>10}{'Acc↑':>10}{'n':>9}"
    lines = [header, "-" * len(header)]
    for name in ("beta", "bkt", "running_mean"):
        m = results[name]
        lines.append(
            f"{name:<14}{m['brier']:>10.4f}{m['auc']:>10.4f}"
            f"{m['accuracy']:>10.4f}{int(m['n']):>9d}"
        )
    return "\n".join(lines)


def _build_interactions(args) -> Tuple[List[Dict], Dict]:
    if args.csv:
        from eval.validity.kt_calibration.loader import load_interactions_csv

        interactions = load_interactions_csv(args.csv)
        source = {"type": "csv", "path": args.csv, "n": len(interactions)}
    else:
        interactions = generate_synthetic(
            n_students=args.students,
            n_skills=args.skills,
            n_attempts=args.attempts,
            seed=args.seed,
        )
        source = {
            "type": "synthetic",
            "seed": args.seed,
            "students": args.students,
            "skills": args.skills,
            "attempts": args.attempts,
            "n": len(interactions),
        }
    return interactions, source


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="KT calibration harness (EV-4)")
    src = parser.add_mutually_exclusive_group()
    src.add_argument("--synth", action="store_true", help="use synthetic data (default)")
    src.add_argument("--csv", type=str, default=None, help="path to a real KT CSV")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--students", type=int, default=50)
    parser.add_argument("--skills", type=int, default=6)
    parser.add_argument("--attempts", type=int, default=20)
    parser.add_argument(
        "--running-difficulty",
        action="store_true",
        help="estimate per-skill difficulty causally (past-only) instead of global",
    )
    parser.add_argument(
        "--no-report", action="store_true", help="do not write a JSON report"
    )
    args = parser.parse_args(argv)

    interactions, source = _build_interactions(args)
    if not interactions:
        print("No interactions to evaluate.")
        return 1

    results = evaluate_models(
        interactions, running_difficulty=args.running_difficulty
    )

    print(f"\nSource: {source}")
    print(_format_table(results))

    beta, floor = results["beta"], results["running_mean"]
    beats = beta["brier"] < floor["brier"] and beta["auc"] > floor["auc"]
    print(
        f"\nBeta beats RunningMean (lower Brier AND higher AUC): {beats}"
    )

    if not args.no_report:
        reports_dir = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_dir, exist_ok=True)
        ts = time.strftime("%Y%m%dT%H%M%S")
        path = os.path.join(reports_dir, f"{ts}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "source": source,
                    "running_difficulty": args.running_difficulty,
                    "results": results,
                    "beta_beats_running_mean": beats,
                },
                fh,
                indent=2,
            )
        print(f"\nReport written: {path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
