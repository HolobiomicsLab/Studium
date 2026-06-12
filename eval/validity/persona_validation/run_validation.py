"""run_validation.py — persona-validity scorecard CLI (EV-9).

Analyze an existing eval run, or run one first then analyze it::

    # analyze an existing run dir
    python run_validation.py --run-dir eval/reports/01-deterministic-...

    # produce a fresh deterministic run for corpus 01, then analyze it
    python run_validation.py --corpus 01

Prints the scorecard + verdict and writes a JSON report under
``eval/validity/persona_validation/reports/<run>.json`` (that dir is gitignored).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
from typing import List, Optional

# Make `eval.validity.persona_validation.*` importable whether invoked as a
# script or a module (repo pytest.ini pins testpaths=packages).
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from eval.validity.persona_validation.validate import validate_run  # noqa: E402

_REPORTS_GLOB = os.path.join(_REPO_ROOT, "eval", "reports", "*")


def _latest_run_dir_for_corpus(corpus: str) -> Optional[str]:
    """Newest eval/reports/<corpus>-* dir (mtime), or None."""
    matches = [
        d
        for d in glob.glob(os.path.join(_REPO_ROOT, "eval", "reports", f"{corpus}-*"))
        if os.path.isdir(d)
    ]
    if not matches:
        return None
    return max(matches, key=os.path.getmtime)


def _run_eval_for_corpus(corpus: str) -> Optional[str]:
    """Run `eval/run_eval.py --corpus NN --author deterministic` then locate the
    produced run dir. Returns the run dir, or None if it could not be produced."""
    cmd = [
        sys.executable,
        os.path.join(_REPO_ROOT, "eval", "run_eval.py"),
        "--corpus",
        corpus,
        "--author",
        "deterministic",
    ]
    print(f"$ {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=_REPO_ROOT)
    if proc.returncode != 0:
        print(f"eval subprocess exited {proc.returncode}", file=sys.stderr)
        return None
    return _latest_run_dir_for_corpus(corpus)


def _fmt_scorecard(card: dict) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("=" * 72)
    lines.append("PERSONA VALIDITY SCORECARD (EV-9 — internal validity)")
    lines.append("=" * 72)
    lines.append(f"run_dir: {card['run_dir']}")
    lines.append("")

    lines.append("Per-persona signatures:")
    header = f"  {'persona':<14}{'done':>5}{'turns':>6}{'mean_mast':>11}{'autonomy':>10}  transitions / rules"
    lines.append(header)
    lines.append("  " + "-" * (len(header) - 2))
    for name, s in sorted(card["personas"].items()):
        tc = ",".join(f"{k}:{v}" for k, v in sorted(s["transition_counts"].items()))
        rules = ",".join(s["rules_fired"])
        lines.append(
            f"  {name:<14}{str(s['completed']):>5}{s['n_turns']:>6}"
            f"{s['mean_mastery']:>11.3f}{s['autonomy_ratio']:>10.2f}  "
            f"[{tc}] {{{rules}}}"
        )
    lines.append("")

    lines.append("Divergence (pairwise collapse_score; high = collapsed):")
    for key, p in sorted(card["divergence"]["pairs"].items()):
        flag = "  <-- COLLAPSE" if p["collapsed"] else ""
        lines.append(f"  {p['a']:>14} vs {p['b']:<14} {p['collapse_score']:.3f}{flag}")
    lines.append(f"  max_collapse_score: {card['divergence']['max_collapse_score']:.3f}")
    lines.append("")

    cov = card["branch_coverage"]
    lines.append("Branch coverage (union of transition kinds + rules):")
    lines.append(f"  expected: {cov['expected']}")
    lines.append(f"  observed: {cov['observed']}")
    lines.append(f"  missing : {cov['missing'] or 'none'}")
    lines.append("")

    lines.append("Findings:")
    if card["findings"]:
        for f in card["findings"]:
            lines.append(f"  [{f['severity'].upper()}] {f['message']}")
    else:
        lines.append("  (none)")
    lines.append("")

    lines.append(f"VERDICT: {card['verdict'].upper()}")
    lines.append("")
    lines.append(f"note: {card['note']}")
    lines.append("=" * 72)
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Persona-validity scorecard (EV-9, internal validity)"
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--run-dir", type=str, help="analyze an existing eval run dir")
    src.add_argument(
        "--corpus",
        type=str,
        help="run eval/run_eval.py --corpus NN (deterministic) first, then analyze",
    )
    parser.add_argument(
        "--no-report", action="store_true", help="do not write a JSON report"
    )
    args = parser.parse_args(argv)

    if args.corpus:
        run_dir = _run_eval_for_corpus(args.corpus)
        if not run_dir:
            # fall back to an existing run dir for that corpus if one exists
            run_dir = _latest_run_dir_for_corpus(args.corpus)
            if run_dir:
                print(
                    f"falling back to existing run dir: {run_dir}", file=sys.stderr
                )
        if not run_dir:
            print(
                f"could not produce or find an eval run for corpus {args.corpus}",
                file=sys.stderr,
            )
            return 2
    else:
        run_dir = args.run_dir
        if not os.path.isdir(run_dir):
            print(f"run dir not found: {run_dir}", file=sys.stderr)
            return 2

    card = validate_run(run_dir)
    print(_fmt_scorecard(card))

    if not args.no_report:
        reports_dir = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_dir, exist_ok=True)
        run_name = os.path.basename(os.path.normpath(run_dir)) or "run"
        path = os.path.join(reports_dir, f"{run_name}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(card, fh, indent=2, ensure_ascii=False)
        print(f"\nReport written: {path}")

    # exit 0 on pass, 1 on flags — usable as a CI gate
    return 0 if card["verdict"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
