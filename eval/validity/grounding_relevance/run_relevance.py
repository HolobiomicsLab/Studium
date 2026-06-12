"""run_relevance.py — grounding-relevance scorecard CLI.

Measures whether a lesson bundle's attached citations are TOPICALLY RELEVANT to
the scenes they ground (lexical proxy), complementing the auditor's
grounding_citations PRESENCE check. Usage::

    # score a specific bundle (zip or lesson.json)
    python run_relevance.py --bundle eval/reports/01-.../01-bundle.zip

    # find the *-bundle.zip inside a run dir and score it
    python run_relevance.py --run-dir eval/reports/01-deterministic-...

Prints the scorecard and writes a JSON report under
``eval/validity/grounding_relevance/reports/<name>.json`` (that dir is gitignored).
Exit code: 0 if verdict != 'presence_only', else 1 (usable as a CI signal that a
bundle's citations are present but off-topic).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from typing import List, Optional

# Make `eval.validity.grounding_relevance.*` importable whether invoked as a
# script or a module (repo pytest.ini pins testpaths=packages).
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from eval.validity.grounding_relevance.analyze import (  # noqa: E402
    analyze_bundle,
    load_bundle,
)


def _find_bundle_in_run_dir(run_dir: str) -> Optional[str]:
    """Return the first ``*-bundle.zip`` inside a run dir, or None."""
    matches = sorted(glob.glob(os.path.join(run_dir, "*-bundle.zip")))
    return matches[0] if matches else None


def _fmt_scorecard(card: dict, source: str) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("=" * 72)
    lines.append("GROUNDING-RELEVANCE SCORECARD (citations on-topic vs presence-only)")
    lines.append("=" * 72)
    lines.append(f"bundle: {source}")
    lines.append(f"threshold (Jaccard): {card['threshold']:.3f}")
    lines.append("")

    n = card["n_evidenced_scenes"]
    mbr = card["mean_best_relevance"]
    mbr_s = f"{mbr:.3f}" if isinstance(mbr, (int, float)) else "n/a"
    lines.append(f"evidenced scenes (intro/concept with citations): {n}")
    lines.append(f"mean best-ref relevance: {mbr_s}")
    lines.append(f"relevance grade (fraction on-topic): {card['relevance_grade']:.3f}")
    lines.append("")

    lines.append("Per-evidenced-scene best-ref relevance:")
    if card["evidenced_scenes"]:
        for ev in card["evidenced_scenes"]:
            flag = "  <-- OFF-TOPIC" if ev["best"] < card["threshold"] else ""
            title = ev["title"] or ev["scene_id"]
            lines.append(f"  {ev['best']:.3f}  {title}{flag}")
            for ref_id, score in ev["per_ref"]:
                lines.append(f"           ref {score:.3f}  {ref_id}")
    else:
        lines.append("  (no evidenced scenes)")
    lines.append("")

    lines.append("Findings (citations present but off-topic):")
    if card["irrelevant_scenes"]:
        for f in card["irrelevant_scenes"]:
            title = f["title"] or f["scene_id"]
            lines.append(
                f"  [IRRELEVANT] {title} — best-ref relevance {f['best_relevance']:.3f}"
            )
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
        description="Grounding-relevance scorecard (citations on-topic vs presence-only)"
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--bundle", type=str, help="path to a bundle .zip or a lesson.json"
    )
    src.add_argument(
        "--run-dir", type=str, help="a run dir; the *-bundle.zip inside it is scored"
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="override the Jaccard relevance threshold (default 0.06)",
    )
    parser.add_argument(
        "--no-report", action="store_true", help="do not write a JSON report"
    )
    args = parser.parse_args(argv)

    if args.run_dir:
        if not os.path.isdir(args.run_dir):
            print(f"run dir not found: {args.run_dir}", file=sys.stderr)
            return 2
        bundle_path = _find_bundle_in_run_dir(args.run_dir)
        if not bundle_path:
            print(f"no *-bundle.zip found in {args.run_dir}", file=sys.stderr)
            return 2
    else:
        bundle_path = args.bundle

    bundle = load_bundle(bundle_path)
    if bundle is None:
        print(f"could not load a bundle from: {bundle_path}", file=sys.stderr)
        return 2

    if args.threshold is not None:
        card = analyze_bundle(bundle, threshold=args.threshold)
    else:
        card = analyze_bundle(bundle)

    print(_fmt_scorecard(card, bundle_path))

    if not args.no_report:
        reports_dir = os.path.join(os.path.dirname(__file__), "reports")
        os.makedirs(reports_dir, exist_ok=True)
        base = os.path.basename(os.path.normpath(bundle_path))
        for ext in (".zip", ".json"):
            if base.endswith(ext):
                base = base[: -len(ext)]
        out = {"bundle": bundle_path, **card}
        path = os.path.join(reports_dir, f"{base or 'bundle'}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2, ensure_ascii=False)
        print(f"\nReport written: {path}")

    # exit 1 when citations are present but off-topic (presence_only)
    return 1 if card["verdict"] == "presence_only" else 0


if __name__ == "__main__":
    raise SystemExit(main())
