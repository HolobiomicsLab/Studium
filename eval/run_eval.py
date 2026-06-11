#!/usr/bin/env python
"""Studium backend eval harness — single orchestrating driver.

A 4-stage, backend-only, manifest-driven runner. NO frontend; the GUI apps are
untouched. See eval/README.md for the full run model + student/auditor contracts.

  Stage 1  AUTHOR   corpus .md -> schema-valid LessonBundle ZIP (w/ LWG + universes)
  Stage 2  DRIVE    LessonSession playthrough per persona (present->decide->respond)
  Stage 3  AUDIT    score the course + the run against a 6-dimension rubric
  Stage 4  REPORT   report.md + refinement_feedback.json mapped to REVIEW-FINDINGS.md

USAGE
  # Full run on one real corpus material (offline deterministic author + key-free drive):
  .venv/bin/python eval/run_eval.py --corpus 04

  # Live Claude author (corpus-faithful LLM authoring) + live driver + LLM auditor:
  .venv/bin/python eval/run_eval.py --corpus 04 --author claude --live --audit-llm

  # Offline smoke (proves the plumbing on the committed fixtures, no author, no keys):
  .venv/bin/python eval/run_eval.py --smoke

  # All corpus materials, deterministic:
  .venv/bin/python eval/run_eval.py --all
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

# make `harness` importable whether invoked as a script or module
sys.path.insert(0, str(Path(__file__).resolve().parent))

from harness.audit import run_audit  # noqa: E402
from harness.author import author_bundle  # noqa: E402
from harness.corpus import get_material, load_manifest  # noqa: E402
from harness.paths import FIXTURES_DIR, REPORTS_DIR  # noqa: E402
from harness.report import write_report  # noqa: E402
from harness.runner import run_session  # noqa: E402

DEFAULT_PERSONAS = ["proficient", "struggling", "overconfident"]
PSEUDO_SECRET = "eval-harness-secret"  # non-default (host/cli default 'dev-secret' is an RGPD defect)


def _ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S")


def _run_personas(bundle_path: Path, run_dir: Path, personas: list[str], live: bool, model: str | None) -> None:
    sessions = run_dir / "sessions"
    for persona in personas:
        out = sessions / persona
        print(f"  [drive] persona={persona} live={live} ...", flush=True)
        res = run_session(
            bundle_path=bundle_path,
            persona=persona,
            out_dir=out,
            live=live,
            # per-persona namespace + distinct secret-derived isolation (design risk #6)
            pseudo_secret=f"{PSEUDO_SECRET}:{persona}",
            model=model,
        )
        print(
            f"    -> completed={res['completed']} turns={res['n_turns']} "
            f"transitions={set(res['transition_kinds'])}",
            flush=True,
        )


def run_full(
    corpus_id: str,
    author_mode: str,
    personas: list[str],
    live: bool,
    audit_llm: bool,
    model: str | None,
) -> Path:
    material = get_material(corpus_id)
    run_dir = REPORTS_DIR / f"{corpus_id}-{author_mode}-{_ts()}"
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"[author] corpus={corpus_id} ({material.title!r}) mode={author_mode}", flush=True)
    res = author_bundle(material, run_dir, mode=author_mode, model=model)
    print(f"  -> bundle={res.bundle_path.name} scenes={res.provenance['scene_types']}", flush=True)
    print(f"  -> lwg edges={res.provenance['lwg_edges']} universes={res.provenance['universe_variants']}", flush=True)

    _run_personas(res.bundle_path, run_dir, personas, live, model)

    print("[audit] scoring course + run ...", flush=True)
    audit = run_audit(run_dir, use_llm=audit_llm, model=model)
    report = write_report(audit, run_dir)
    print(f"[report] overall={audit['overall_score']} -> {report}", flush=True)
    print(f"  dimension_scores={audit['dimension_scores']}", flush=True)
    return run_dir


def run_smoke(personas: list[str], live: bool, audit_llm: bool, model: str | None) -> Path:
    """Offline smoke: drive the committed m3 fixture (no author step, no keys),
    audit + report. Proves the harness plumbing end to end without authoring.

    Note: the committed fixtures carry NO LWG/universes (verified), so the audit
    will correctly report adaptivity as untestable for the smoke path — that is
    the harness honestly surfacing REVIEW-FINDINGS #6.
    """
    fixture = FIXTURES_DIR / "m3" / "demo-metabolomics-bundle.zip"
    if not fixture.exists():
        raise FileNotFoundError(f"smoke fixture missing: {fixture}")
    run_dir = REPORTS_DIR / f"smoke-m3-{_ts()}"
    run_dir.mkdir(parents=True, exist_ok=True)
    # copy the fixture into the run dir as <id>-bundle.zip so the auditor finds it
    bundle_path = run_dir / "m3-bundle.zip"
    shutil.copy2(fixture, bundle_path)
    # a minimal provenance so the auditor/report have context
    (run_dir / "author_provenance.json").write_text(
        '{"author_mode": "fixture-smoke", "author_label": "committed-m3-fixture", '
        '"corpus_id": "m3", "corpus_title": "demo-metabolomics (committed fixture)", '
        '"bundler_validated_at_offset_defect": false, "synthetic_assessment": true, '
        '"warning": "Smoke path: committed fixture, NOT authored from a corpus. No LWG/universes."}\n',
        encoding="utf-8",
    )
    _run_personas(bundle_path, run_dir, personas, live, model)
    audit = run_audit(run_dir, use_llm=audit_llm, model=model)
    report = write_report(audit, run_dir)
    print(f"[smoke] overall={audit['overall_score']} -> {report}", flush=True)
    return run_dir


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Studium backend eval harness")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--corpus", help="corpus id from eval/corpus/manifest.json (e.g. 04)")
    g.add_argument("--all", action="store_true", help="run every corpus material")
    g.add_argument("--smoke", action="store_true", help="offline smoke over the committed m3 fixture (no author)")
    g.add_argument("--list", action="store_true", help="list corpus materials and exit")
    p.add_argument("--author", choices=["deterministic", "claude"], default="deterministic",
                   help="author backend (deterministic=key-free; claude=live LLM authoring)")
    p.add_argument("--personas", nargs="+", default=DEFAULT_PERSONAS,
                   help=f"student personas to drive (default: {DEFAULT_PERSONAS})")
    p.add_argument("--live", action="store_true", help="drive with live LLM scorers (LiteLLM/Http) instead of stubs")
    p.add_argument("--audit-llm", action="store_true", help="augment the heuristic audit with a Claude auditor pass")
    p.add_argument("--model", default=None, help="model id for claude author/student/auditor (optional)")
    return p


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    if args.list:
        for m in load_manifest():
            print(f"{m.id:>3}  [{m.branch}] {m.discipline} — {m.title}")
        return 0

    if args.smoke:
        run_smoke(args.personas, args.live, args.audit_llm, args.model)
        return 0

    if args.all:
        for m in load_manifest():
            print(f"\n===== corpus {m.id} =====")
            try:
                run_full(m.id, args.author, args.personas, args.live, args.audit_llm, args.model)
            except Exception as exc:  # keep going across the corpus; report the failure
                print(f"  [FAIL] corpus {m.id}: {exc}", flush=True)
        return 0

    run_full(args.corpus, args.author, args.personas, args.live, args.audit_llm, args.model)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
