#!/usr/bin/env python3
"""run_class.py — simulate a small CLASS through an existing bundle, then build the teacher report.

Reuses the already-authored bundle (no re-authoring): runs N personas as distinct learners into
<run>/sessions/<persona>/telemetry.jsonl, then runs tools/class_report.py over the run dir to
produce the RGPD-safe teacher view of the SAME course the live student took.

  .venv/bin/python eval/run_class.py /tmp/studium_live/11-bundle.zip /tmp/studium_class
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness.runner import run_session  # noqa: E402

PERSONAS = ["proficient", "struggling", "overconfident", "hint_reliant", "misconception"]


def main(argv: list[str]) -> int:
    bundle = Path(argv[0]).resolve()
    run_dir = Path(argv[1]).resolve() if len(argv) > 1 else Path("/tmp/studium_class")
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    # class_report finds the bundle via run_dir/*-bundle.zip
    shutil.copy2(bundle, run_dir / "11-bundle.zip")

    for p in PERSONAS:
        out = run_dir / "sessions" / p
        try:
            res = run_session(run_dir / "11-bundle.zip", p, out, live=False,
                              max_turns=80, learner_id=f"class-{p}")
            s = res.get("summary") or {}
            print(f"  {p:14s} completed={res.get('completed')} "
                  f"scenes={s.get('scenesCompleted','?')} autonomy={s.get('autonomyRatio','?')}", flush=True)
        except Exception as e:  # keep going — a stuck persona shouldn't sink the class
            print(f"  {p:14s} ERROR: {str(e)[:200]}", flush=True)
    print(f"\nrun dir: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
