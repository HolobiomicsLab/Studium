#!/usr/bin/env python3
"""class_report.py — teacher-facing CLASS analytics over Studium telemetry (RGPD-safe).

The twin of the eval aggregator, for the *runtime* side. It consumes a directory of
per-learner telemetry streams (`sessions/<learner>/telemetry.jsonl` — the same ADR-006
events the runtime emits: pseudonymized refs + scalars, NO free text, NO mastery claims) and
produces a CLASS-LEVEL report: which concepts to re-teach, where hint-reliance and
miscalibration cluster, completion. It is privacy-preserving by construction:

  * output is AGGREGATE only — never a per-learner row, never a pseudonym;
  * a k-anonymity floor (`--min-learners`, default 5) refuses to report when too few
    learners would make a concept-level number re-identifiable;
  * telemetry carries no free text (hint text, journal text, discussion text never leave the
    device), so none can appear here.

This is exactly what a teacher gets without ever touching an individual mastery record (those
stay local on the learner's device). Wrap as one `lesson-mcp` tool (`class_report`) for the
teacher's agent client.

Usage:
  python tools/class_report.py <run_or_collector_dir> [--min-learners 5] [--out DIR]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import statistics
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

# The trust-calibration maths lives in the analytics collector; import it rather than
# re-implement (a third copy is how the TS/Py over_distrust drift happened).
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "analytics-collector"))
from metrics import TRUST_WELL_BAND, _over_distrust_rate  # noqa: E402

# adaptation rule_ids that signal the learner needed support (remediation / gating / escalation)
_REMEDIATION_RULES = ("remediate", "prereq_gate", "replay", "escalat")


def _scene_to_concept(run_dir: Path, bundle_path: Path | None = None) -> dict[str, str]:
    """Map scene_id -> concept_id from the run's bundle, so per-scene telemetry rolls up to concepts.

    The bundle is found as run_dir/*-bundle.zip, or supplied explicitly via `bundle_path` (needed for
    the durable MCP-host layout, where telemetry lives under data/<pseudonym>/<bundle_id>/ with no
    co-located bundle zip)."""
    bz = bundle_path or next(run_dir.glob("*-bundle.zip"), None)
    if not bz or not Path(bz).exists():
        return {}
    p = Path(bz)
    try:
        if p.is_dir():                       # directory bundle: <dir>/lesson.json
            bundle = json.loads((p / "lesson.json").read_text(encoding="utf-8"))
        elif p.suffix == ".json":            # a lesson.json passed directly
            bundle = json.loads(p.read_text(encoding="utf-8"))
        else:                                 # a *-bundle.zip
            bundle = json.loads(zipfile.ZipFile(bz).read("lesson.json"))
    except Exception:
        return {}
    out = {}
    for s in bundle.get("scenes", []):
        refs = s.get("concept_refs") or []
        out[s.get("id")] = refs[0] if refs else s.get("id")
    return out


def build_report(run_dir: Path, min_learners: int = 5, bundle_path: Path | None = None) -> dict:
    s2c = _scene_to_concept(run_dir, bundle_path)
    # Discover telemetry streams anywhere under the run dir — covers both the eval layout
    # (sessions/<persona>/telemetry.jsonl) and the durable MCP-host layout
    # (data/<pseudonym>/<bundle_id>/telemetry.jsonl). Each file = one learner-session.
    streams = sorted(str(p) for p in Path(run_dir).rglob("telemetry.jsonl"))
    # per-concept accumulators (aggregated across learners)
    by_concept: dict[str, dict] = defaultdict(lambda: {
        "attempts": 0, "correct": 0, "hint_requests": 0, "conf_sum": 0.0,
        "overconfident": 0, "underconfident": 0, "time_ms": 0, "timed": 0,
    })
    trust_by_scene: dict[str, dict] = defaultdict(lambda: {
        "planted": 0, "missed": 0, "fp": 0, "sound": 0,
    })
    rule_counts: Counter = Counter()
    n_started = n_completed = 0
    autonomy: list[float] = []
    escalations = 0
    learners = 0

    for sf in streams:
        learners += 1
        for line in Path(sf).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            t = e.get("type")
            if t == "lesson_started":
                n_started += 1
            elif t == "lesson_completed":
                n_completed += 1
                if isinstance(e.get("autonomy_ratio"), (int, float)):
                    autonomy.append(e["autonomy_ratio"])
            elif t == "quiz_answered":
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                a = by_concept[c]
                a["attempts"] += 1
                a["correct"] += 1 if e.get("correct") else 0
                conf = float(e.get("confidence") or 0.0)
                a["conf_sum"] += conf
                if conf >= 0.6 and not e.get("correct"):
                    a["overconfident"] += 1
                if conf <= 0.4 and e.get("correct"):
                    a["underconfident"] += 1
                a["time_ms"] += int(e.get("response_time_ms") or 0)
                a["timed"] += 1
            elif t == "critique_submitted":
                # Scored free-response scenes (ai_critique / spot_the_flaw / explain_back) roll up
                # into the SAME per-concept accuracy as quizzes: a pass is llm_score >= 0.6. These
                # items carry NO self-rated confidence, so they must stay CALIBRATION-NEUTRAL: conf_sum
                # gets the SAME binary as `correct` (1.0 on pass else 0.0), making their contribution to
                # calibration_gap exactly 0 (conf == accuracy). Adding the raw score instead would falsely
                # shift the gap on concepts that mix quizzes and critiques. No response_time → not `timed`.
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                a = by_concept[c]
                a["attempts"] += 1
                passed = float(e.get("llm_score") or 0.0) >= 0.6
                a["correct"] += 1 if passed else 0
                a["conf_sum"] += 1.0 if passed else 0.0
            elif t == "ai_audit_result":
                sid = str(e.get("scene_id") or "")
                a = trust_by_scene[sid]
                a["planted"] += int(e.get("planted_errors") or 0)
                a["missed"] += int(e.get("missed") or 0)
                a["fp"] += int(e.get("false_positives") or 0)
                a["sound"] += int(e.get("sound_total") or 0)
            elif t == "hint_requested":
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                by_concept[c]["hint_requests"] += 1
            elif t == "adaptation_applied":
                rid = str(e.get("rule_id") or "")
                rule_counts[rid] += 1
                if "escalat" in rid:
                    escalations += 1

    if learners < min_learners:
        return {"status": "suppressed", "n_learners": learners, "min_learners": min_learners,
                "reason": f"k-anonymity floor: need >= {min_learners} learners for a class report "
                          f"(have {learners}). Per-concept numbers could re-identify individuals."}

    concepts = []
    for cid, a in by_concept.items():
        n = a["attempts"] or 1
        concepts.append({
            "concept": cid,
            "n_attempts": a["attempts"],
            "accuracy": round(a["correct"] / n, 3),
            "hint_reliance": round(a["hint_requests"] / n, 3),
            "calibration_gap": round((a["conf_sum"] / n) - (a["correct"] / n), 3),  # + = overconfident
            "overconfidence_rate": round(a["overconfident"] / n, 3),
            "mean_time_s": round(a["time_ms"] / (a["timed"] or 1) / 1000, 1),  # only timed (quiz) items
        })
    # surface the concepts most in need of re-teaching: low accuracy, then high hint-reliance
    concepts.sort(key=lambda x: (x["accuracy"], -x["hint_reliance"]))

    return {
        "status": "ok",
        "n_learners": learners,
        "completion_rate": round(n_completed / n_started, 3) if n_started else None,
        "mean_autonomy": round(statistics.mean(autonomy), 3) if autonomy else None,
        "universe_escalations": escalations,
        "top_adaptation_rules": rule_counts.most_common(6),
        "concepts": concepts,
        "reteach_priority": [c["concept"] for c in concepts if c["accuracy"] < 0.8][:5],
        "trust_calibration": _trust_section(trust_by_scene, s2c),
    }


def _trust_section(trust_by_scene: dict[str, dict], s2c: dict) -> dict:
    """Class-level trust-calibration over grounded spot_the_flaw audits, mirroring
    the collector's compute_trust_calibration (same helpers, same bands). Returns an
    explicit not-measured shape when the run carries no grounded audits — an absent
    number must read as "not measured here", never as "no trust issues"."""
    scenes = []
    gaps = []
    for sid, c in sorted(trust_by_scene.items()):
        if c["planted"] <= 0:
            continue
        over_trust = c["missed"] / c["planted"]
        over_distrust = _over_distrust_rate(c["fp"], c["sound"])
        gap = max(-1.0, min(1.0, over_trust - (over_distrust or 0.0)))
        gaps.append(gap)
        scenes.append({
            "scene": s2c.get(sid, sid), "gap": round(gap, 3),
            "over_trust": round(over_trust, 3),
            "over_distrust": None if over_distrust is None else round(over_distrust, 3),
            "planted": c["planted"], "missed": c["missed"], "false_positives": c["fp"],
        })
    if not gaps:
        return {"measured": False, "n_scenes": 0,
                "note": "no grounded audits in this run — trust calibration NOT measured"}
    overall = sum(gaps) / len(gaps)
    band = "bien" if abs(overall) <= TRUST_WELL_BAND else ("sur" if overall > 0 else "sous")
    return {"measured": True, "n_scenes": len(gaps), "gap": round(overall, 3),
            "band": band, "scenes": scenes}


def _md(rep: dict) -> str:
    if rep.get("status") != "ok":
        return f"# Class report — SUPPRESSED\n\n{rep.get('reason')}"
    L = ["# Class report (aggregate, RGPD-safe — no individual records)", ""]
    L.append(f"learners: {rep['n_learners']} · completion: {rep['completion_rate']} · "
             f"mean autonomy: {rep['mean_autonomy']} · universe escalations: {rep['universe_escalations']}")
    L.append("")
    L.append("## Concepts (worst first — candidates to re-teach)")
    L.append("| concept | n | accuracy | hint-reliance | calibration gap | overconf. | mean time (s) |")
    L.append("|---|--:|--:|--:|--:|--:|--:|")
    for c in rep["concepts"]:
        L.append(f"| {c['concept']} | {c['n_attempts']} | {c['accuracy']} | {c['hint_reliance']} | "
                 f"{c['calibration_gap']:+} | {c['overconfidence_rate']} | {c['mean_time_s']} |")
    L.append("")
    L.append("## Trust calibration (judgment over real artifacts)")
    tc = rep.get("trust_calibration") or {}
    if not tc.get("measured"):
        L.append(tc.get("note", "not measured"))
    else:
        L.append(f"overall gap: {tc['gap']:+} ({tc['band']}) over {tc['n_scenes']} grounded scene(s) "
                 "— + credulous (missed planted flaws), − skeptical (flagged sound claims)")
        L.append("")
        L.append("| scene/concept | gap | over-trust | over-distrust | planted | missed | false pos. |")
        L.append("|---|--:|--:|--:|--:|--:|--:|")
        for s in tc["scenes"]:
            od = "n/m" if s["over_distrust"] is None else f"{s['over_distrust']}"
            L.append(f"| {s['scene']} | {s['gap']:+} | {s['over_trust']} | {od} | "
                     f"{s['planted']} | {s['missed']} | {s['false_positives']} |")
    L.append("")
    L.append(f"**Re-teach priority:** {', '.join(rep['reteach_priority']) or '(none — class above 0.8)'}")
    L.append(f"\n**Top adaptations fired:** {rep['top_adaptation_rules']}")
    L.append("\n> Calibration gap > 0 = class over-confident on that concept. No learner is named; "
             "individual mastery records never leave the learner's device.")
    return "\n".join(L)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="RGPD-safe class analytics over Studium telemetry")
    ap.add_argument("run_dir")
    ap.add_argument("--min-learners", type=int, default=5)
    ap.add_argument("--out", default=None)
    ap.add_argument("--bundle", default=None,
                    help="explicit bundle .zip (for the durable MCP layout with no co-located bundle)")
    args = ap.parse_args(argv)
    bundle = Path(args.bundle).resolve() if args.bundle else None
    rep = build_report(Path(args.run_dir).resolve(), args.min_learners, bundle)
    md = _md(rep)
    print(md)
    if args.out:
        out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
        (out / "class_report.md").write_text(md + "\n", encoding="utf-8")
        (out / "class_report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
        print(f"\n[written] {out/'class_report.md'} + class_report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
