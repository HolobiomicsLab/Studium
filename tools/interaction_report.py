#!/usr/bin/env python3
"""interaction_report.py — usage report over the interaction events of INT-STUDIUM-058 (§ 2.10).

The twin of `class_report.py` for HOW the two-lane interface is used rather than what the class
learned. It consumes the same input — a directory of per-learner telemetry streams, found with
`rglob("telemetry.jsonl")` (eval layout `sessions/<persona>/telemetry.jsonl`, durable layout
`<pseudonym>/<bundle_id>/telemetry.jsonl`) — and the seven event types of the interaction
contract (`interaction`, `prompt_shown`, `prompt_outcome`, `help_used`, `contest`, `resume`,
`review_receipt`, in `packages/telemetry-events`). It publishes the § 2.10 indicators:

  * fast-lane share: `interaction` acts with lane `fast` among all `interaction` acts, on hosts of
    surface_rank >= 2 (target 0.8);
  * verdict delay: 95th percentile (nearest rank) of `client_ms` over `interaction` acts
    `respond` that carry one (target 1000 ms);
  * prompt outcomes: accepted / dismissed / ignored per `kind`; a kind with at least 30 outcomes
    and an acceptance under 20 % is flagged (review the kind or its budget);
  * help use: `help_used` counts per rung, overall and per scene_id; `respond` acts on a scene
    counted "after" when the same stream holds an earlier `help_used` rung `explain` on that
    scene, "before" otherwise (a `respond` without scene_id is in neither);
  * contests: count, and confirmed / refuted / partial;
  * resumes: count per cause, and scenes shown twice — for each `resume`, the first later
    `interaction` of the same stream carrying a scene_id is counted when that scene_id already
    appeared on an `interaction` earlier in the stream (target zero);
  * review: number of `review_receipt`, the share fully opened (opened == items), the mean share
    of items opened (over receipts with items > 0), decisions approved / returned.

"Order" within a stream is the order of its lines, which is the order the host appended them.
What it does NOT measure: the agent's first word ("premier mot de l'agent") comes from the bench,
not from telemetry; learning ("apprentissage") is `class_report.py`'s, not this report's.

Privacy stance — the one `class_report.py` documents, applied the same way:

  * CONSENT FIRST. A stream that carries no `consent_granted` event is refused: it is skipped and
    counted in `refused_streams` (an integer: no path, no pseudonym);
  * output is AGGREGATE only — never a per-learner row, never a pseudonym, never a path, and not
    the exact cohort size (a band, `cohort_band`, as the collector publishes it);
  * the floor (`MIN_LEARNERS`, defined once in the collector's `metrics.py`) counts DISTINCT
    learners by the same identity rule as `class_report.py`. Under it the whole report is
    withheld (`suppressed: true`) and states the floor, not the cohort. Each indicator, each
    per-kind row and each per-scene row is computed over its own contributors and withheld when
    they are fewer than the floor — rows are dropped and a flag says so, without a count. The
    floor can be raised, never lowered: a lower `--min-learners` is clamped up, and said;
  * the floor restrains singling out; it is not an anonymity guarantee, since a teacher knows the
    class (INT-STUDIUM-030);
  * the only strings copied from events are closed enums (acts, lanes, rungs, causes, outcomes,
    decisions, prompt kinds) and identifiers (scene ids). Events of the seven types are validated
    against the Python contract first; one that fails is counted in `invalid_events` and skipped.
    Malformed JSON lines are counted in `malformed_lines`, never echoed. Other event types are
    ignored (only `consent_granted` is read, for consent).

`--single-stream FILE` is for the labelled synthetic learners of the benches only: one stream,
no floor, `scope: "single_stream"` and a warning that the figures are one learner's.

Usage:
  python tools/interaction_report.py <run_dir> [--min-learners 5] [--out DIR] [--json]
  python tools/interaction_report.py <telemetry.jsonl> --single-stream [--out DIR] [--json]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(_ROOT / "packages" / "telemetry-events" / "python"))
from class_report import (  # noqa: E402  (also puts the collector's `metrics` on sys.path)
    MIN_LEARNERS_DEFAULT,
    _identity_rule,
    _population,
)
from metrics import NON_ATTRIBUTION  # noqa: E402
from pydantic import TypeAdapter, ValidationError  # noqa: E402
from telemetry_events import TelemetryEvent  # noqa: E402

_CONTRACT = TypeAdapter(TelemetryEvent)
_TYPES = ("interaction", "prompt_shown", "prompt_outcome", "help_used", "contest", "resume",
          "review_receipt")
_RUNGS = ("reread", "hint", "explain", "reference")
_OUTCOMES = ("accepted", "dismissed", "ignored")
_CONTEST_OUTCOMES = ("confirmed", "refuted", "partial")
_CAUSES = ("restart", "surface_change", "paused")
_DECISIONS = ("approved", "returned")

FAST_LANE_TARGET = 0.8
VERDICT_DELAY_TARGET_MS = 1000
#: A prompt kind is flagged when it has at least this many outcomes ...
ACCEPTANCE_MIN_OUTCOMES = 30
#: ... and fewer than this share of them were accepted (spec § 2.10).
ACCEPTANCE_FLOOR = 0.2

REFUSED_NO_CONSENT = "refused: no consent_granted event in this stream"
SINGLE_STREAM_WARNING = ("single stream: these figures are one learner's (a labelled synthetic "
                         "learner of a bench) and must not be read for a person")


class RefusedStream(ValueError):
    """A stream that cannot be reported: it carries no recorded consent."""


def _read_stream(path: Path) -> tuple[list[dict], int, int, bool, set[tuple]]:
    """The stream's events of the seven types (contract-validated), its malformed and invalid
    line counts, whether it carries a `consent_granted` event, and the (lesson_id,
    learner_pseudonym) pairs its parsed events carry — every event counts toward who is in the
    class, as in `class_report.py`, not only the seven types."""
    events: list[dict] = []
    malformed = invalid = 0
    consent = False
    identities: set[tuple] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            malformed += 1
            continue
        if not isinstance(e, dict):
            malformed += 1
            continue
        identities.add((e.get("lesson_id"), e.get("learner_pseudonym")))
        t = e.get("type")
        if t == "consent_granted":
            consent = True
            continue
        if t not in _TYPES:
            continue
        try:
            _CONTRACT.validate_python(e)
        except ValidationError:
            invalid += 1
            continue
        events.append(e)
    return events, malformed, invalid, consent, identities


class _Acc:
    """Accumulators for the indicators. A member is a (lesson, pseudonym, stream) triple, the
    raw form `class_report._population` resolves under one identity rule."""

    def __init__(self) -> None:
        self.fast = self.acts = 0
        self.fast_by: set = set()
        self.delays: list[float] = []
        self.delay_by: set = set()
        self.outcomes: dict[str, Counter] = defaultdict(Counter)
        self.outcome_by: dict[str, set] = defaultdict(set)
        self.rungs: Counter = Counter()
        self.help_by: set = set()
        self.scene_rungs: dict[str, Counter] = defaultdict(Counter)
        self.scene_by: dict[str, set] = defaultdict(set)
        self.before = self.after = 0
        self.explain_split_by: set = set()
        self.contests: Counter = Counter()
        self.contest_by: set = set()
        self.causes: Counter = Counter()
        self.twice = 0
        self.resume_by: set = set()
        self.receipts = self.fully = 0
        self.opened_shares: list[float] = []
        self.decisions: Counter = Counter()
        self.review_by: set = set()

    def add_stream(self, events: list[dict], sf: str) -> None:
        explained: set[str] = set()
        seen: set[str] = set()
        pending_resume = False
        for e in events:
            member = (e.get("lesson_id"), e.get("learner_pseudonym"), sf)
            t = e["type"]
            if t == "interaction":
                scene = e.get("scene_id")
                if e["surface_rank"] >= 2:
                    self.acts += 1
                    self.fast += e["lane"] == "fast"
                    self.fast_by.add(member)
                if e["act"] == "respond":
                    if e.get("client_ms") is not None:
                        self.delays.append(float(e["client_ms"]))
                        self.delay_by.add(member)
                    if scene:
                        if scene in explained:
                            self.after += 1
                        else:
                            self.before += 1
                        self.explain_split_by.add(member)
                if scene:
                    if pending_resume:
                        self.twice += scene in seen
                        pending_resume = False
                    seen.add(scene)
            elif t == "prompt_outcome":
                self.outcomes[e["kind"]][e["outcome"]] += 1
                self.outcome_by[e["kind"]].add(member)
            elif t == "help_used":
                self.rungs[e["rung"]] += 1
                self.help_by.add(member)
                self.scene_rungs[e["scene_id"]][e["rung"]] += 1
                self.scene_by[e["scene_id"]].add(member)
                if e["rung"] == "explain":
                    explained.add(e["scene_id"])
            elif t == "contest":
                self.contests[e["outcome"]] += 1
                self.contest_by.add(member)
            elif t == "resume":
                self.causes[e["cause"]] += 1
                self.resume_by.add(member)
                pending_resume = True
            elif t == "review_receipt":
                self.receipts += 1
                self.fully += e["opened"] == e["items"]
                if e["items"] > 0:
                    self.opened_shares.append(min(e["opened"], e["items"]) / e["items"])
                self.decisions[e["decision"]] += 1
                self.review_by.add(member)


def _p95(values: list[float]) -> float:
    """Nearest-rank 95th percentile: the smallest value with at least 95 % of values at or under it."""
    ordered = sorted(values)
    v = ordered[max(1, math.ceil(0.95 * len(ordered))) - 1]
    return int(v) if float(v).is_integer() else round(v, 1)


def _indicators(acc: _Acc, rule: str, floor: int | None) -> dict:
    """Every § 2.10 indicator. `floor=None` (single stream) publishes without a floor."""
    def state(members: set) -> str:
        if not members:
            return "empty"
        if floor is not None and _population(members, rule).below_floor(floor):
            return "withheld"
        return "published"

    def gate(members: set, figures) -> dict:
        st = state(members)
        if st == "empty":
            return {"measured": False}
        if st == "withheld":
            return {"measured": True, "withheld": True}
        return {"measured": True, **figures()}

    rep: dict = {}
    rep["fast_lane"] = gate(acc.fast_by, lambda: {
        "acts": acc.acts, "fast": acc.fast, "share": round(acc.fast / acc.acts, 3),
        "target": FAST_LANE_TARGET, "meets_target": acc.fast / acc.acts >= FAST_LANE_TARGET})
    rep["verdict_delay"] = gate(acc.delay_by, lambda: {
        "n": len(acc.delays), "p95_ms": _p95(acc.delays), "target_ms": VERDICT_DELAY_TARGET_MS,
        "meets_target": _p95(acc.delays) <= VERDICT_DELAY_TARGET_MS})

    kinds, kinds_withheld = [], False
    for kind in sorted(acc.outcomes):
        if state(acc.outcome_by[kind]) != "published":
            kinds_withheld = True
            continue
        c = acc.outcomes[kind]
        total = sum(c.values())
        acceptance = c["accepted"] / total
        kinds.append({"kind": kind, **{o: c[o] for o in _OUTCOMES}, "total": total,
                      "acceptance": round(acceptance, 3),
                      "flagged": total >= ACCEPTANCE_MIN_OUTCOMES and acceptance < ACCEPTANCE_FLOOR})
    rep["prompt_outcomes"] = {
        "kinds": kinds, "flagged_kinds": [k["kind"] for k in kinds if k["flagged"]],
        "rule": (f"flagged: at least {ACCEPTANCE_MIN_OUTCOMES} outcomes and under "
                 f"{int(ACCEPTANCE_FLOOR * 100)} % accepted — review the kind or its budget"),
        "withheld_below_floor": kinds_withheld}

    scenes, scenes_withheld = [], False
    for sid in sorted(acc.scene_rungs):
        if state(acc.scene_by[sid]) != "published":
            scenes_withheld = True
            continue
        scenes.append({"scene_id": sid, **{r: acc.scene_rungs[sid][r] for r in _RUNGS}})
    help_use = gate(acc.help_by, lambda: {"by_rung": {r: acc.rungs[r] for r in _RUNGS}})
    help_use["scenes"] = scenes
    help_use["withheld_below_floor"] = scenes_withheld
    split = state(acc.explain_split_by)
    help_use["answers_before_explain"] = acc.before if split == "published" else None
    help_use["answers_after_explain"] = acc.after if split == "published" else None
    rep["help_use"] = help_use

    rep["contests"] = gate(acc.contest_by, lambda: {
        "count": sum(acc.contests.values()),
        "by_outcome": {o: acc.contests[o] for o in _CONTEST_OUTCOMES}})
    rep["resumes"] = gate(acc.resume_by, lambda: {
        "count": sum(acc.causes.values()), "by_cause": {c: acc.causes[c] for c in _CAUSES},
        "scenes_shown_twice": acc.twice, "target_scenes_shown_twice": 0})
    rep["review"] = gate(acc.review_by, lambda: {
        "receipts": acc.receipts, "fully_opened_share": round(acc.fully / acc.receipts, 3),
        "mean_opened_share": (round(sum(acc.opened_shares) / len(acc.opened_shares), 3)
                              if acc.opened_shares else None),
        "decisions": {d: acc.decisions[d] for d in _DECISIONS}})
    return rep


def build_interaction_report(run_dir: Path, *, min_learners: int = MIN_LEARNERS_DEFAULT) -> dict:
    """The class report over every consented stream under `run_dir`. The floor is never below
    `MIN_LEARNERS_DEFAULT`: a lower value is clamped up."""
    floor = max(int(min_learners), MIN_LEARNERS_DEFAULT)
    acc = _Acc()
    malformed = invalid = refused = 0
    has_pseudonym: dict[str, bool] = {}
    members: set[tuple] = set()
    for path in sorted(Path(run_dir).rglob("telemetry.jsonl")):
        events, bad, wrong, consent, identities = _read_stream(path)
        if not consent:
            refused += 1
            continue
        malformed += bad
        invalid += wrong
        sf = str(path)
        has_pseudonym[sf] = any(isinstance(p, str) and p for _lesson, p in identities)
        members |= {(lesson, pseudo, sf) for lesson, pseudo in identities}
        acc.add_stream(events, sf)

    head = {"scope": "class", "min_learners": floor, "refused_streams": refused,
            "malformed_lines": malformed, "invalid_events": invalid}
    if min_learners < floor:
        head["min_learners_note"] = (f"--min-learners {min_learners} raised to the floor "
                                     f"{floor}: it can be raised, never lowered")

    def suppressed(reason: str, has_data: bool) -> dict:
        return {"status": "suppressed", "suppressed": True, **head, "has_data": has_data,
                "reason": reason}

    rule = _identity_rule(has_pseudonym)
    if rule is None and has_pseudonym:
        return suppressed("no single identity rule counts this directory: some streams carry a "
                          "learner_pseudonym and some do not. Report the two layouts separately.",
                          True)
    rule = rule or "stream"
    population = _population(members, rule)
    if not has_pseudonym:
        return suppressed(f"no consented telemetry streams found under {run_dir} — check the "
                          "path, and that each stream records a consent_granted event", False)
    if population.below_floor(floor):
        return suppressed(f"floor: a usage report needs at least {floor} learners in every "
                          f"lesson and this directory has fewer in at least one. Figures over "
                          f"fewer learners could single one out; the size is withheld for the "
                          f"same reason.", True)

    return {"status": "ok", "suppressed": False, **head,
            "identity_rule": rule, **population.judgement(floor),
            **_indicators(acc, rule, floor)}


def build_single_stream_report(path: Path) -> dict:
    """One stream, no floor: for the labelled synthetic learners of the benches only. Raises
    `RefusedStream` when the stream records no consent."""
    events, malformed, invalid, consent, _identities = _read_stream(Path(path))
    if not consent:
        raise RefusedStream(REFUSED_NO_CONSENT)
    acc = _Acc()
    acc.add_stream(events, str(path))
    return {"status": "ok", "suppressed": False, "scope": "single_stream",
            "warning": SINGLE_STREAM_WARNING, "refused_streams": 0,
            "malformed_lines": malformed, "invalid_events": invalid,
            **_indicators(acc, "stream", None)}


def _md(rep: dict) -> str:
    if rep.get("status") != "ok":
        return f"# Usage report — SUPPRESSED\n\n{rep.get('reason')}"
    L = ["# Usage report (aggregate — no individual records)", ""]
    if rep["scope"] == "single_stream":
        L += [f"> **{rep['warning']}.**", ""]
    else:
        L += [f"Cohort: {rep['cohort_band']} ({rep['cohort_counts']}), floor {rep['min_learners']}.",
              ""]
    L.append(f"Refused streams (no consent): {rep['refused_streams']} · malformed lines: "
             f"{rep['malformed_lines']} · invalid events: {rep['invalid_events']}")

    def head(title: str, block: dict) -> bool:
        L.extend(["", f"## {title}"])
        if not block.get("measured"):
            L.append("not measured")
            return False
        if block.get("withheld"):
            L.append("withheld (fewer learners than the floor)")
            return False
        return True

    fl = rep["fast_lane"]
    if head("Fast lane (surface rank 2 and above)", fl):
        L.append(f"{fl['fast']} of {fl['acts']} acts settled without a model: {fl['share']} "
                 f"(target {fl['target']}, {'met' if fl['meets_target'] else 'not met'})")
    vd = rep["verdict_delay"]
    if head("Verdict delay (answers)", vd):
        L.append(f"95th percentile {vd['p95_ms']} ms over {vd['n']} answers "
                 f"(target {vd['target_ms']} ms, {'met' if vd['meets_target'] else 'not met'})")

    po = rep["prompt_outcomes"]
    L.extend(["", "## Prompt outcomes"])
    if po["kinds"]:
        L += ["| kind | accepted | dismissed | ignored | total | acceptance | flag |",
              "|---|--:|--:|--:|--:|--:|:-:|"]
        L += [f"| {k['kind']} | {k['accepted']} | {k['dismissed']} | {k['ignored']} | {k['total']} "
              f"| {k['acceptance']} | {'review' if k['flagged'] else ''} |" for k in po["kinds"]]
    else:
        L.append("no kind to show")
    L.append(f"\n*{po['rule']}.*")
    if po["withheld_below_floor"]:
        L.append("\n> At least one kind is not shown: fewer learners than the floor.")

    hu = rep["help_use"]
    if head("Help use", hu):
        L.append("By rung: " + ", ".join(f"{r} {n}" for r, n in hu["by_rung"].items()))
    if hu["scenes"]:
        L += ["", "| scene | reread | hint | explain | reference |", "|---|--:|--:|--:|--:|"]
        L += [f"| {s['scene_id']} | {s['reread']} | {s['hint']} | {s['explain']} | {s['reference']} |"
              for s in hu["scenes"]]
    if hu["answers_before_explain"] is not None:
        L.append(f"\nAnswers before an explain on their scene: {hu['answers_before_explain']} · "
                 f"after: {hu['answers_after_explain']}")
    if hu["withheld_below_floor"]:
        L.append("\n> At least one scene is not shown: fewer learners than the floor.")

    ct = rep["contests"]
    if head("Contests", ct):
        L.append(f"{ct['count']} — " + ", ".join(f"{o} {n}" for o, n in ct["by_outcome"].items()))
    rs = rep["resumes"]
    if head("Resumes", rs):
        L.append(f"{rs['count']} — " + ", ".join(f"{c} {n}" for c, n in rs["by_cause"].items())
                 + f" · scenes shown twice after a resume: {rs['scenes_shown_twice']} (target 0)")
    rv = rep["review"]
    if head("Review receipts", rv):
        L.append(f"{rv['receipts']} receipts · fully opened {rv['fully_opened_share']} · mean share "
                 f"opened {rv['mean_opened_share']} · approved {rv['decisions']['approved']}, "
                 f"returned {rv['decisions']['returned']}")
    if rep["scope"] == "class":
        L.append(f"\n> {NON_ATTRIBUTION}.")
    return "\n".join(L)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Usage report over Studium interaction telemetry")
    ap.add_argument("run_dir", help="folder of telemetry streams (a file with --single-stream)")
    ap.add_argument("--min-learners", type=int, default=MIN_LEARNERS_DEFAULT,
                    help=f"floor over distinct learners; can be raised, never lowered below "
                         f"{MIN_LEARNERS_DEFAULT}")
    ap.add_argument("--single-stream", action="store_true",
                    help="report ONE telemetry.jsonl, without a floor (bench synthetic learners only)")
    ap.add_argument("--out", default=None, help="also write interaction_report.json and .md here")
    ap.add_argument("--json", action="store_true", help="print JSON instead of Markdown")
    args = ap.parse_args(argv)
    target = Path(args.run_dir).resolve()

    if args.single_stream:
        if not target.is_file():
            print("--single-stream takes one telemetry.jsonl file", file=sys.stderr)
            return 2
        try:
            rep = build_single_stream_report(target)
        except RefusedStream as refusal:
            print(str(refusal), file=sys.stderr)
            return 3
    else:
        rep = build_interaction_report(target, min_learners=args.min_learners)
        if "min_learners_note" in rep:
            print(rep["min_learners_note"], file=sys.stderr)

    md = _md(rep)
    print(json.dumps(rep, indent=2) if args.json else md)
    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "interaction_report.md").write_text(md + "\n", encoding="utf-8")
        (out / "interaction_report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
        print(f"[written] {out / 'interaction_report.md'} + interaction_report.json", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
