#!/usr/bin/env python3
"""run_class.py — simulate a CLASS through an existing bundle, then build the teacher report.

Reuses the already-authored bundle (no re-authoring): runs a cohort of personas as distinct
learners into <run>/sessions/<learner>/telemetry.jsonl, then runs tools/class_report.py over the
run dir to produce the RGPD-safe teacher view of the SAME course the live student took.

  .venv/bin/python eval/run_class.py /tmp/studium_live/11-bundle.zip /tmp/studium_class
  .venv/bin/python eval/run_class.py <bundle> <run_dir> --learners 4    # below the floor
  .venv/bin/python eval/run_class.py <bundle> <run_dir> --learners 24   # a real class

WHY `--learners` (INT-STUDIUM-030). This exercise is where the k floor is *observed*, and with a
fixed cohort of five against a floor of five it could only ever be observed on its own boundary:
suppression had never been produced by the thing an operator runs, and neither had an aggregate
over a class-sized cohort. The default is unchanged; the two cases either side of the floor are
now one flag away. Beyond the five authored personas the cohort cycles them — a sixth learner is
a second `proficient` with their own learner id, which is what a class looks like anyway.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from harness.runner import run_session  # noqa: E402
import class_report  # noqa: E402
from class_report import MIN_LEARNERS_DEFAULT  # noqa: E402

PERSONAS = ["proficient", "struggling", "overconfident", "hint_reliant", "misconception"]


def cohort(n_learners: int) -> list[tuple[str, str]]:
    """`n_learners` (persona, learner_id) pairs. Personas cycle; learner ids never repeat."""
    out = []
    for i in range(n_learners):
        p = PERSONAS[i % len(PERSONAS)]
        out.append((p, p if i < len(PERSONAS) else f"{p}-{i // len(PERSONAS) + 1}"))
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bundle")
    ap.add_argument("run_dir", nargs="?", default="/tmp/studium_class")
    ap.add_argument("--learners", type=int, default=len(PERSONAS),
                    help=f"cohort size (default {len(PERSONAS)}; the report's floor is "
                         f"{MIN_LEARNERS_DEFAULT})")
    args = ap.parse_args(argv)

    bundle = Path(args.bundle).resolve()
    run_dir = Path(args.run_dir).resolve()
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    # class_report finds the bundle via run_dir/*-bundle.zip
    shutil.copy2(bundle, run_dir / "11-bundle.zip")

    for persona, learner in cohort(args.learners):
        out = run_dir / "sessions" / learner
        try:
            res = run_session(run_dir / "11-bundle.zip", persona, out, live=False,
                              max_turns=80, learner_id=f"class-{learner}")
            s = res.get("summary") or {}
            print(f"  {learner:16s} completed={res.get('completed')} "
                  f"scenes={s.get('scenesCompleted','?')} autonomy={s.get('autonomyRatio','?')}", flush=True)
        except Exception as e:  # keep going — a stuck persona shouldn't sink the class
            print(f"  {learner:16s} ERROR: {str(e)[:200]}", flush=True)

    # The teacher view this exercise exists to produce, through the same CLI an operator runs.
    # Without it the floor is implemented and never observed: the run ended at a directory of
    # telemetry nobody had asked a question of.
    print()
    class_report.main([str(run_dir), "--out", str(run_dir)])
    print(f"run dir: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
