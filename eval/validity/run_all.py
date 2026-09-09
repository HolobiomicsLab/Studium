#!/usr/bin/env python
"""run_all.py — run the whole eval validity suite and print a combined summary.

Thin orchestrator over the three validity tools (each independently tested):
  - kt_calibration   (EV-4)  : learner-model calibration on synthetic KT
  - persona_validation (EV-9): simulated-student divergence/branch-coverage
  - grounding_relevance      : citation on-topic vs presence-only

Usage:
  python eval/validity/run_all.py --corpus 01     # runs an eval, then validates it
  python eval/validity/run_all.py --run-dir DIR   # validates an existing eval run dir

It also writes ONE aggregate scorecard (INT-STUDIUM-002) naming the run id, the commit, and
the digest of every report it read — see `scorecard.py`. Printing a summary that vanishes with
the terminal was the whole gap: a paragraph could cite these numbers and nothing in the
repository said which run they came from.
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from eval.validity import scorecard as scorecard_mod  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
EVAL_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(EVAL_DIR)
PY = sys.executable


def _run(label: str, argv: list[str]) -> int:
    print(f"\n{'=' * 70}\n[{label}]\n{'=' * 70}", flush=True)
    proc = subprocess.run(argv, cwd=REPO)
    print(f"[{label}] exit={proc.returncode}", flush=True)
    return proc.returncode


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Studium eval validity suite")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--corpus", help="run eval on this corpus id then validate")
    g.add_argument("--run-dir", help="validate an existing eval run dir")
    p.add_argument("--seed", default="1", help="kt_calibration synthetic seed")
    p.add_argument("--scorecard", default=os.path.join(HERE, "SCORECARD.json"),
                   help="aggregate scorecard to write (a sibling .md is written beside it); "
                        "pass an empty string to skip")
    args = p.parse_args(argv)

    codes: dict[str, int] = {}

    # Prefer the REAL external benchmark if it has been fetched
    # (eval/validity/kt_calibration/fetch_assistments.py); else synthetic.
    real_csv = os.path.join(HERE, "kt_calibration", "data", "assistments09_canonical.csv")
    if os.path.isfile(real_csv):
        kt_label = "kt_calibration (EV-4, REAL ASSISTments 2009)"
        kt_argv = [PY, "eval/validity/kt_calibration/run_calibration.py", "--csv", real_csv]
    else:
        kt_label = (
            "kt_calibration (EV-4, synthetic — run "
            "eval/validity/kt_calibration/fetch_assistments.py for the external number)"
        )
        kt_argv = [
            PY, "eval/validity/kt_calibration/run_calibration.py", "--synth", "--seed", args.seed
        ]
    codes["kt_calibration"] = _run(kt_label, kt_argv)

    run_dir = args.run_dir
    persona_argv = [PY, "eval/validity/persona_validation/run_validation.py"]
    if run_dir:
        persona_argv += ["--run-dir", run_dir]
    elif args.corpus:
        persona_argv += ["--corpus", args.corpus]
    if len(persona_argv) > 2:
        codes["persona_validation"] = _run("persona_validation (EV-9)", persona_argv)
        # locate the run dir the persona step used/produced for the relevance check
        if not run_dir and args.corpus:
            cands = sorted(glob.glob(os.path.join(EVAL_DIR, "reports", f"{args.corpus}-*")))
            run_dir = cands[-1] if cands else None
    else:
        print("\n[persona_validation] skipped (need --corpus or --run-dir)", flush=True)

    if run_dir:
        codes["grounding_relevance"] = _run(
            "grounding_relevance",
            [PY, "eval/validity/grounding_relevance/run_relevance.py", "--run-dir", run_dir],
        )
    else:
        print("\n[grounding_relevance] skipped (no run dir)", flush=True)

    if run_dir:
        codes["bea_tutor"] = _run(
            "bea_tutor (EV-3b, authored scaffolding)",
            [PY, "eval/validity/bea_tutor/run_bea.py", "--run-dir", run_dir],
        )
    else:
        print("\n[bea_tutor] skipped (no run dir)", flush=True)

    if run_dir:
        codes["reasoning_depth"] = _run(
            "reasoning_depth (EV-3c, hybrid scorecard)",
            [PY, "eval/validity/reasoning_depth/run_reasoning_depth.py", "--run-dir", run_dir],
        )
    else:
        print("\n[reasoning_depth] skipped (no run dir)", flush=True)

    if run_dir and args.scorecard:
        # Written from the tools' own reports, not from what this process printed: the
        # scorecard has to be checkable against files on disk, including by someone who was
        # not here when it ran.
        card = scorecard_mod.build(run_dir, Path(HERE), Path(REPO), codes)
        json_path = Path(args.scorecard)
        scorecard_mod.write(card, json_path, json_path.with_suffix(".md"))
        print(f"\n[scorecard] {json_path} (+ .md) — run_id={card['run_id']}")
        unattributed = [n for n, t in card["tools"].items() if t["attributed_to_run"] is False]
        if unattributed:
            print(f"[scorecard] NOT attributable to this run: {', '.join(unattributed)}")
    elif not run_dir:
        print("\n[scorecard] skipped (no run dir)", flush=True)

    print(f"\n{'=' * 70}\nVALIDITY SUITE SUMMARY\n{'=' * 70}")
    for k, v in codes.items():
        print(f"  {k:22s} exit={v}  ({'ok' if v == 0 else 'FLAGS/ERROR'})")
    print("  (exit!=0 = the tool flagged something — read its report above)")
    # the suite is informational: return 0 unless a tool hard-errored (exit > 1)
    return 0 if all(c <= 1 for c in codes.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
