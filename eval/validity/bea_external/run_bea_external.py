"""run_bea_external.py — EV-8a: validate + improve the BEA guidance detector on MathDial."""
from __future__ import annotations
import argparse, json, os, sys
from collections import Counter
from typing import Dict, List, Optional
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
from eval.validity.bea_external.loader import load_mathdial_csv, TeacherTurn  # noqa: E402
from eval.validity.bea_external.predictor import evaluate  # noqa: E402
from eval.validity.bea_external.tune import improve  # noqa: E402
from eval.validity.bea_tutor.bea import score_revealing_answer  # noqa: E402

_REVEAL_NOTE = (
    "MathDial's `telling` label is BROADER than BEA #3 revealing-answer: telling turns mostly "
    "confirm intermediate steps or give corrective feedback and rarely state the final answer. "
    "So we report reveal firing rate by move DESCRIPTIVELY and do NOT treat `telling` as reveal gold "
    "(that construct needs EV-5 human ratings). The validated dim here is guiding-vs-direct."
)


def reveal_rate_by_move(turns: List[TeacherTurn]) -> Dict[str, dict]:
    agg: Dict[str, List[int]] = {}
    for t in turns:
        revealed = score_revealing_answer(t.text, t.banned)["revealed"]
        d = agg.setdefault(t.move, [0, 0])
        d[0] += 1 if revealed else 0
        d[1] += 1
    return {m: {"n": c[1], "reveal_rate": (c[0] / c[1]) if c[1] else 0.0} for m, c in agg.items()}


def main(argv: Optional[List[str]] = None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="EV-8a MathDial BEA validation + improve")
    p.add_argument("--csv", default=os.path.join(here, "data", "mathdial_train.csv"))
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--no-report", action="store_true")
    a = p.parse_args(argv)
    if not os.path.isfile(a.csv):
        print(f"MathDial CSV not found: {a.csv}\nRun: python {here}/fetch_mathdial.py", file=sys.stderr)
        return 2
    turns = load_mathdial_csv(a.csv)
    if not turns:
        print("no labeled turns parsed", file=sys.stderr)
        return 2
    move_dist = Counter(t.move for t in turns)
    baseline = evaluate(turns, ())
    imp = improve(turns, seed=a.seed)
    reveal = reveal_rate_by_move(turns)
    print("=" * 72)
    print("EV-8a — MathDial-anchored BEA guidance/actionability validation")
    print("=" * 72)
    print(f"teacher turns: {len(turns)}  moves: {dict(move_dist)}")
    print(f"guiding detector vs gold (whole set): f1={baseline['f1']:.3f} "
          f"precision={baseline['precision']:.3f} recall={baseline['recall']:.3f} kappa={baseline['kappa']:.3f}")
    print(f"improve loop (held-out test): baseline f1={imp['baseline']['f1']:.3f} -> "
          f"improved f1={imp['improved']['f1']:.3f}  extra_terms={imp['chosen_extra_terms']}")
    print(f"reveal firing rate by move (DESCRIPTIVE): "
          + ", ".join(f"{m}={reveal[m]['reveal_rate']:.2f}" for m in sorted(reveal)))
    print(f"\nnote(reveal): {_REVEAL_NOTE}")
    out = {"n_turns": len(turns), "move_distribution": dict(move_dist),
           "guiding_detector_wholeset": baseline, "improve": imp,
           "reveal_rate_by_move": reveal, "reveal_note": _REVEAL_NOTE}
    if not a.no_report:
        with open(os.path.join(here, "external_result.json"), "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2, ensure_ascii=False)
        print(f"\nReport written: {os.path.join(here, 'external_result.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
