#!/usr/bin/env python
"""run_all.py — run the whole eval validity suite and print a combined summary.

Thin orchestrator over the three validity tools (each independently tested):
  - kt_calibration   (EV-4)  : learner-model calibration on synthetic KT
  - persona_validation (EV-9): simulated-student divergence/branch-coverage
  - grounding_relevance      : citation on-topic vs presence-only

Usage:
  python eval/validity/run_all.py --corpus 01     # runs an eval, then validates it
  python eval/validity/run_all.py --run-dir DIR   # validates an existing eval run dir
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys

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
    args = p.parse_args(argv)

    codes: dict[str, int] = {}

    codes["kt_calibration"] = _run(
        "kt_calibration (EV-4)",
        [PY, "eval/validity/kt_calibration/run_calibration.py", "--synth", "--seed", args.seed],
    )

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

    print(f"\n{'=' * 70}\nVALIDITY SUITE SUMMARY\n{'=' * 70}")
    for k, v in codes.items():
        print(f"  {k:22s} exit={v}  ({'ok' if v == 0 else 'FLAGS/ERROR'})")
    print("  (exit!=0 = the tool flagged something — read its report above)")
    # the suite is informational: return 0 unless a tool hard-errored (exit > 1)
    return 0 if all(c <= 1 for c in codes.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
