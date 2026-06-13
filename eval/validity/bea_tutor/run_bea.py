"""run_bea.py — BEA tutor-move scorecard over a bundle's authored scaffolding (EV-3b)."""
from __future__ import annotations
import argparse, glob, json, os, sys
from typing import List, Optional
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
from eval.validity.grounding_relevance.analyze import load_bundle  # noqa: E402
from eval.validity.bea_tutor.bea import score_bundle  # noqa: E402

def _find_bundle(run_dir: str) -> Optional[str]:
    m = sorted(glob.glob(os.path.join(run_dir, "*-bundle.zip")))
    return m[0] if m else None

def _fmt(rep: dict, source: str) -> str:
    L = ["", "=" * 72, "BEA TUTOR-MOVE SCORECARD (authored scaffolding)", "=" * 72, f"bundle: {source}",
         f"moves scored: {rep['n_moves']}", f"reveal_rate (lower better): {rep['reveal_rate']:.3f}",
         f"actionability_rate: {rep['actionability_rate']:.3f}",
         f"summative_safe_rate: {rep['summative_safe_rate']:.3f}", ""]
    for c in rep["cards"]:
        rev = c["dims"]["revealing_answer"]["revealed"]
        act = c["dims"]["actionability"]["score"]
        flag = "  <-- REVEALS" if rev else ""
        L.append(f"  [{c['move_kind']}] reveal={rev} action={act:.0f}{flag}")
    L += ["", f"note: {rep['note']}", "=" * 72]
    return "\n".join(L)

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="BEA tutor-move scorecard (authored scaffolding)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--bundle"); g.add_argument("--run-dir")
    p.add_argument("--no-report", action="store_true")
    a = p.parse_args(argv)
    path = a.bundle or _find_bundle(a.run_dir)
    if not path:
        print("no bundle found", file=sys.stderr); return 2
    bundle = load_bundle(path)
    if bundle is None:
        print(f"could not load bundle: {path}", file=sys.stderr); return 2
    rep = score_bundle(bundle)
    print(_fmt(rep, path))
    if not a.no_report:
        d = os.path.join(os.path.dirname(__file__), "reports"); os.makedirs(d, exist_ok=True)
        base = os.path.basename(os.path.normpath(path))
        for ext in (".zip", ".json"):
            if base.endswith(ext): base = base[:-len(ext)]
        with open(os.path.join(d, f"{base or 'bundle'}.json"), "w", encoding="utf-8") as fh:
            json.dump({"bundle": path, **rep}, fh, indent=2, ensure_ascii=False)
    return 1 if rep["reveal_rate"] > 0 else 0

if __name__ == "__main__":
    raise SystemExit(main())
