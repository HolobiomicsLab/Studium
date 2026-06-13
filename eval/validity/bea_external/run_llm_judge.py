# run_llm_judge.py — EV-8b CLI: validate the LLM guidance judge on MathDial.
# The DEFAULT run makes one real `claude` call per sampled turn (operator-driven, costs
# inference). Unit tests inject a StubJudge via run(...). Pure orchestration.
from __future__ import annotations
import argparse, json, os, sys
from typing import List, Optional
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
from eval.validity.bea_external.loader import load_mathdial_csv, TeacherTurn  # noqa: E402
from eval.validity.bea_external.validate import validate_judge  # noqa: E402


def run(turns: List[TeacherTurn], client, n_per_move: int = 25, seed: int = 0) -> dict:
    return validate_judge(turns, client, n_per_move=n_per_move, seed=seed)


def main(argv: Optional[List[str]] = None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="EV-8b LLM guidance-judge validation on MathDial")
    p.add_argument("--csv", default=os.path.join(here, "data", "mathdial_train.csv"))
    p.add_argument("--n-per-move", type=int, default=25, help="sample size per move type (×4)")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--model", default=None, help="claude --model (default: CLI default)")
    p.add_argument("--no-report", action="store_true")
    a = p.parse_args(argv)
    if not os.path.isfile(a.csv):
        print(f"MathDial CSV not found: {a.csv}\nRun fetch_mathdial.py first.", file=sys.stderr)
        return 2
    turns = load_mathdial_csv(a.csv)
    if not turns:
        print("no labeled turns parsed", file=sys.stderr)
        return 2
    from eval.harness.llm import ClaudeCli, claude_available
    if not claude_available():
        print("`claude` CLI not found — cannot run the live judge.", file=sys.stderr)
        return 2
    client = ClaudeCli(model=a.model)
    print(f"Judging {a.n_per_move}×4 turns with the live `claude` judge (one call per turn)...",
          file=sys.stderr, flush=True)
    rep = run(turns, client, n_per_move=a.n_per_move, seed=a.seed)
    llm, det = rep["llm_vs_gold"], rep["deterministic_vs_gold"]
    print("=" * 72)
    print("EV-8b — LLM guidance-judge vs MathDial gold (vs deterministic detector)")
    print("=" * 72)
    print(f"sample n={rep['n']}  null_judgments={rep['n_null_judgments']}")
    print(f"  LLM judge   : f1={llm['f1']:.3f} precision={llm['precision']:.3f} "
          f"recall={llm['recall']:.3f} kappa={llm['kappa']:.3f} qwk={llm['qwk']:.3f}")
    print(f"  deterministic: f1={det['f1']:.3f} precision={det['precision']:.3f} "
          f"recall={det['recall']:.3f} kappa={det['kappa']:.3f}")
    print(f"\nnote: {rep['note']}")
    if not a.no_report:
        with open(os.path.join(here, "external_result_llm.json"), "w", encoding="utf-8") as fh:
            json.dump({"n_per_move": a.n_per_move, "seed": a.seed, "model": a.model, **rep},
                      fh, indent=2, ensure_ascii=False)
        print(f"\nReport written: {os.path.join(here, 'external_result_llm.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
