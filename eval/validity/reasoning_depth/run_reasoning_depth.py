# run_reasoning_depth.py — hybrid reasoning_depth scorecard CLI (EV-3c).
from __future__ import annotations
import argparse, glob, json, os, sys
from typing import List, Optional
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
from eval.validity.reasoning_depth.telemetry import read_events  # noqa: E402
from eval.validity.reasoning_depth.scorecard import build_scorecard  # noqa: E402
from eval.validity.grounding_relevance.analyze import load_bundle  # noqa: E402


def _find_bundle(run_dir: str) -> Optional[str]:
    m = sorted(glob.glob(os.path.join(run_dir, "*-bundle.zip")))
    return m[0] if m else None


def _fmt(card: dict) -> str:
    t, c, v = card["trajectory"], card["contingency"], card["verdict"]
    slope = "n/a" if t["depth_slope"] is None else f"{t['depth_slope']:.3f}"
    cov = "n/a" if t["target_coverage"] is None else f"{t['target_coverage']:.3f}"
    rate = "n/a" if c["rate"] is None else f"{c['rate']:.3f}"
    L = ["", "=" * 72, "HYBRID REASONING-DEPTH SCORECARD (vector, not a scalar)", "=" * 72,
         f"trajectory: n_signals={t['n_signals']} depth_slope={slope} entropy={t['signal_entropy']:.3f} target_coverage={cov}",
         f"  histogram: {t['signal_histogram']}",
         f"contingency: n_moves={c['n_moves']} rate={rate} reveal_violations={c['reveal_violations']}",
         f"tutor_quality: {card['tutor_quality']}",
         f"verdict: anti_offloading_ok={v['anti_offloading_ok']} eliciting_depth={v['eliciting_depth']} contingent={v['contingent']}",
         "", f"note: {card['note']}", "=" * 72]
    return "\n".join(L)


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Hybrid reasoning_depth scorecard (EV-3c)")
    p.add_argument("--run-dir", required=True)
    p.add_argument("--no-report", action="store_true")
    a = p.parse_args(argv)
    if not os.path.isdir(a.run_dir):
        print(f"run dir not found: {a.run_dir}", file=sys.stderr)
        return 2
    events = read_events(a.run_dir)
    bundle_path = _find_bundle(a.run_dir)
    bundle = load_bundle(bundle_path) if bundle_path else None
    card = build_scorecard(events, bundle)
    print(_fmt(card))
    if not a.no_report:
        d = os.path.join(os.path.dirname(__file__), "reports"); os.makedirs(d, exist_ok=True)
        base = os.path.basename(os.path.normpath(a.run_dir))
        with open(os.path.join(d, f"{base or 'run'}.json"), "w", encoding="utf-8") as fh:
            json.dump({"run_dir": a.run_dir, **card}, fh, indent=2, ensure_ascii=False)
    # informational tool: hard veto -> exit 1 if anti-offloading violated, else 0
    return 1 if not card["verdict"]["anti_offloading_ok"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
