#!/usr/bin/env python3
"""class_report.py — teacher-facing CLASS analytics over Studium telemetry (RGPD-safe).

The twin of the eval aggregator, for the *runtime* side. It consumes a directory of
per-learner telemetry streams (`sessions/<learner>/telemetry.jsonl` — the same ADR-006
events the runtime emits: pseudonymized refs + scalars, NO free text, NO mastery claims) and
produces a CLASS-LEVEL report: which concepts to re-teach, where hint-reliance and
miscalibration cluster, completion. It is privacy-preserving by construction:

  * output is AGGREGATE only — never a per-learner row, never a pseudonym;
  * a floor (`--min-learners`, default `MIN_LEARNERS_DEFAULT` = 5) withholds class-level
    numbers computed over too few learners. It is a RESTRAINT ON SINGLING OUT, not a guarantee
    of anonymity (INT-STUDIUM-030): k-anonymity protects against a reader who does not know the
    population, and the teacher of a class does know it — five pseudonyms behind a number are
    five people they can usually name. What the floor delivers is that this instrument does not
    become a per-student report, by accident, by drill-down, or by patient reading over time.
    Read it as that restraint; a guarantee that is not delivered is worse than none, because it
    is relied upon. It counts DISTINCT LEARNERS, not telemetry files: the durable host layout
    writes one stream per (pseudonym, bundle), so a cohort of two can be three files;
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
from metrics import (  # noqa: E402
    AUTONOMY_INDICATOR_NAME as _COLLECTOR_AUTONOMY_NAME,
    MIN_LEARNERS,
    NON_ATTRIBUTION,
    TRUST_WELL_BAND,
    Population,
    _over_distrust_rate,
    cohort_band,
)

#: The floor: the smallest cohort a class-level number may be computed over. It restrains
#: singling out; at class scale it is not an anonymity guarantee — see the module docstring
#: and INT-STUDIUM-030.
#: Its value is the product owner's (RGPD) and it has exactly one definition, in the
#: collector's `metrics.py` — the deepest module the live endpoints and this report share.
#: It moved there when the live collector started applying it too (INT-STUDIUM-005); this
#: name is kept because the Observatory (`services/observatory/observatory_config.py`) and
#: the CLI default below already import it (INT-STUDIUM-019).
MIN_LEARNERS_DEFAULT = MIN_LEARNERS

#: INT-STUDIUM-023 — the operator-facing name of the ratio this report averages.
#:
#: The runtime stamps `autonomy_ratio` on each `lesson_completed`: scenes completed over
#: scenes completed plus scaffolding (hints dispensed, scene replays, prerequisite
#: remediations), computed on the device for ONE session. `mean_autonomy` below is the mean
#: of those. The collector publishes a different measurement under the same wire key —
#: `metrics.AUTONOMY_INDICATOR_NAME`, a class-level ratio of critique events to
#: critique-plus-hint events — so the two disagree by construction.
#:
#: Neither wire key moves: historical streams carry `autonomy_ratio`, and the Observatory's
#: sessions column reads `mean_autonomy` by that name. What separates the two constructs is
#: the name a teacher reads, which is this one.
AUTONOMY_INDICATOR_NAME = "scaffolding independence"

# adaptation rule_ids that signal the learner needed support (remediation / gating / escalation)
_REMEDIATION_RULES = ("remediate", "prereq_gate", "replay", "escalat")

#: The lesson key for a stream that names no lesson. Only reachable under the STREAM rule,
#: where one run directory is one bundle by construction (`_scene_to_concept` maps the scenes
#: with a single bundle), so "this run" is the lesson and saying so beats inventing an id.
_RUN_LESSON = "<this run>"

#: The two identity rules, and the sentence each publishes about what it counted. R1 requires
#: the population to be counted by EXACTLY ONE rule; these are the two this report can apply,
#: and a directory that would need both is refused rather than summed (`_identity_rule`).
_RULES = {
    "pseudonym": ("distinct learner_pseudonym per lesson — the durable host layout "
                  "(data/<pseudonym>/<bundle_id>/telemetry.jsonl). A pseudonym is "
                  "HMAC(learnerId:lessonId), so these are people within one lesson"),
    "stream": ("one telemetry stream, one learner — the eval layout "
               "(sessions/<persona>/telemetry.jsonl), which carries no pseudonym. The "
               "population is streams, and it is named as streams rather than as people"),
}


def _identity_rule(has_pseudonym: dict[str, bool]) -> str | None:
    """Which rule counts this directory's population, or `None` when no single rule does.

    THE DEFECT THIS REPLACES: `learner_ids |= stream_ids or {f"stream:{sf}"}` summed the two
    rules. In a directory where some streams carry pseudonyms and some do not, the result was
    neither people nor streams — it was a count with no definition, and the k-floor was then
    applied to it. A cohort that cannot be counted by one rule is not a cohort this report can
    floor, so it is refused (INT-STUDIUM-030, R1, clause 2).
    """
    if not has_pseudonym:
        return None
    kinds = set(has_pseudonym.values())
    if kinds == {True}:
        return "pseudonym"
    if kinds == {False}:
        return "stream"
    return None


def _population(members: set[tuple], rule: str) -> Population:
    """The members a number was computed over, resolved under the ONE rule for this run.

    Accumulated as raw `(lesson, pseudonym, stream)` triples at the point each number is
    computed, and resolved here — so the population is never re-derived from a second
    predicate walking the events again, which is the drift `metrics.Population` documents.
    """
    pop = Population()
    for lesson, pseudonym, stream in members:
        # `lesson_id` is REQUIRED on every ADR-006 event (telemetry_events.BaseEvent), so the
        # fallback is only reached by synthetic or legacy streams — and there the run is one
        # bundle by construction, since `_scene_to_concept` maps its scenes from exactly one.
        # A run that mixes named and unnamed lessons is refused before this point rather than
        # collapsed here, which is the same clause-2 argument as the identity rule itself.
        pop.add(lesson or _RUN_LESSON, pseudonym if rule == "pseudonym" else stream)
    return pop


def _judgement(members: set[tuple], rule: str, floor: int) -> dict:
    """What a judgement number publishes about its own population: the band, the unit, and
    what the number is not. The three keys are the collector's, byte for byte."""
    pop = _population(members, rule)
    return pop.judgement(floor)


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


def build_report(run_dir: Path, min_learners: int = MIN_LEARNERS_DEFAULT,
                 bundle_path: Path | None = None) -> dict:
    s2c = _scene_to_concept(run_dir, bundle_path)
    # Discover telemetry streams anywhere under the run dir — covers both the eval layout
    # (sessions/<persona>/telemetry.jsonl) and the durable MCP-host layout
    # (data/<pseudonym>/<bundle_id>/telemetry.jsonl). Each file = one learner-session.
    streams = sorted(str(p) for p in Path(run_dir).rglob("telemetry.jsonl"))
    # per-concept accumulators (aggregated across learners). Each figure names the population R1
    # requires: the raw (lesson, pseudonym, stream) triples of the learners it is computed over,
    # resolved under the run's one identity rule after the scan, and floored on its own (SEC-2: a
    # row's floor used to count everyone who sent an event, hint-only learners included, while its
    # accuracy, gap and time were computed over the answers of fewer). The rules are the MCP
    # class_report's (apps/lesson-mcp/src/teacher-tools.ts); a parity test runs both on one stream.
    by_concept: dict[str, dict] = defaultdict(lambda: {
        "attempts": 0, "measured": 0, "correct": 0,
        "rated_n": 0, "rated_correct": 0, "rated_conf_sum": 0.0,
        "overconfident": 0, "underconfident": 0, "time_ms": 0, "timed": 0,
        "attempting": set(), "measured_by": set(), "rated_by": set(), "timed_by": set(), "hinted_by": set(),
    })
    trust_by_scene: dict[str, dict] = defaultdict(lambda: {
        "planted": 0, "missed": 0, "fp": 0, "sound": 0, "members": set(),
    })
    rule_counts: Counter = Counter()
    n_started = n_completed = 0
    autonomy: list[float] = []
    escalations = 0
    # The k floor is a floor on PEOPLE. One learner writes one stream per bundle in the durable
    # host layout (data/<pseudonym>/<bundle_id>/telemetry.jsonl), so counting files reports a
    # cohort larger than the class actually is — the wrong side of a privacy floor to be wrong
    # on. Identity is the `learner_pseudonym` the runtime stamps on every event; a stream that
    # carries none (the eval layout, sessions/<persona>/) counts as one learner, as before.
    # Which rule can count this directory, decided once from what the streams actually carry.
    has_pseudonym: dict[str, bool] = {}
    members: set[tuple] = set()
    autonomy_members: set[tuple] = set()
    completion_members: set[tuple] = set()

    for sf in streams:
        stream_ids: set[str] = set()
        for line in Path(sf).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            pseudo = e.get("learner_pseudonym")
            if isinstance(pseudo, str) and pseudo:
                stream_ids.add(pseudo)
            member = (e.get("lesson_id"), pseudo, sf)
            members.add(member)
            t = e.get("type")
            if t == "lesson_started":
                n_started += 1
                completion_members.add(member)
            elif t == "lesson_completed":
                n_completed += 1
                completion_members.add(member)
                if isinstance(e.get("autonomy_ratio"), (int, float)):
                    autonomy.append(e["autonomy_ratio"])
                    autonomy_members.add(member)
            elif t == "quiz_answered":
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                a = by_concept[c]
                correct = bool(e.get("correct"))
                a["attempting"].add(member)
                a["attempts"] += 1
                a["measured"] += 1
                a["measured_by"].add(member)
                a["correct"] += 1 if correct else 0
                # I-5 / H5: confidence is optional. An unrated answer carries NO self-rated
                # confidence: it is left out of the calibration figures entirely (not 0.0, and not
                # conf == correctness, which diluted a rated gap toward 0 and showed 0.0 —
                # "perfectly calibrated" — for a concept nobody rated). A rating of 0.0 is a rating.
                raw_conf = e.get("confidence")
                if isinstance(raw_conf, (int, float)) and not isinstance(raw_conf, bool):
                    conf = float(raw_conf)
                    a["rated_n"] += 1
                    a["rated_correct"] += 1 if correct else 0
                    a["rated_conf_sum"] += conf
                    a["rated_by"].add(member)
                    if conf >= 0.6 and not correct:
                        a["overconfident"] += 1
                    if conf <= 0.4 and correct:
                        a["underconfident"] += 1
                # Only an answer that carries a time is timed: a missing time is not 0 s.
                raw_ms = e.get("response_time_ms")
                if isinstance(raw_ms, (int, float)) and not isinstance(raw_ms, bool):
                    a["time_ms"] += raw_ms
                    a["timed"] += 1
                    a["timed_by"].add(member)
            elif t == "critique_submitted":
                # Scored free-response scenes (ai_critique / spot_the_flaw / explain_back) count as an
                # attempt; they reach accuracy only when a model judge or a verdict deck scored them
                # (score_source "llm" / "verdict_deck"), a pass being llm_score >= 0.6. A keyword score
                # nobody judged is not a measure of understanding (RT-3): it used to rank a concept
                # first for re-teaching on the strength of a keyword match. These items carry no
                # self-rated confidence and no response time, so they never enter calibration or time.
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                a = by_concept[c]
                a["attempting"].add(member)
                a["attempts"] += 1
                if e.get("score_source") in ("llm", "verdict_deck"):
                    score = e.get("llm_score")
                    passed = isinstance(score, (int, float)) and not isinstance(score, bool) and score >= 0.6
                    a["measured"] += 1
                    a["measured_by"].add(member)
                    a["correct"] += 1 if passed else 0
            elif t == "ai_audit_result":
                sid = str(e.get("scene_id") or "")
                a = trust_by_scene[sid]
                a["members"].add(member)
                a["planted"] += int(e.get("planted_errors") or 0)
                a["missed"] += int(e.get("missed") or 0)
                a["fp"] += int(e.get("false_positives") or 0)
                a["sound"] += int(e.get("sound_total") or 0)
            elif t == "hint_requested":
                c = s2c.get(e.get("scene_id"), e.get("scene_id"))
                by_concept[c]["hinted_by"].add(member)
            elif t == "adaptation_applied":
                rid = str(e.get("rule_id") or "")
                rule_counts[rid] += 1
                if "escalat" in rid:
                    escalations += 1
        has_pseudonym[sf] = bool(stream_ids)

    named_lessons = {bool(lesson) for lesson, _pseudo, _sf in members}
    if named_lessons == {True, False}:
        return {"status": "suppressed", "min_learners": min_learners, "has_data": True,
                "reason": ("no single rule places these events in a lesson: some carry a "
                           "lesson_id and some do not. Counting both under one key would put "
                           "events from different lessons in one population, which is exactly "
                           "what the per-lesson floor exists to prevent.")}

    rule = _identity_rule(has_pseudonym)
    if rule is None and has_pseudonym:
        # Clause 2 of R1, and the reason this branch exists at all: the two rules used to be
        # SUMMED here, so a directory holding both layouts reported a population that was
        # neither people nor streams, and the floor was applied to it.
        return {"status": "suppressed", "min_learners": min_learners, "has_data": True,
                "reason": ("no single identity rule counts this directory: some telemetry "
                           "streams carry a learner_pseudonym and some do not, so the "
                           "population would be part people and part files. Report the two "
                           "layouts separately.")}

    population = _population(members, rule or "stream")
    learners = population.size
    if population.below_floor(min_learners):
        # The suppressed report states the FLOOR, never the cohort. Publishing the exact count
        # here inverted the floor: a class of twenty was an aggregate, and a class of two was
        # reported as *two* — the only cohorts named exactly were the ones the floor exists to
        # protect (INT-STUDIUM-030). `n_streams` is the same leak by another route, since every
        # learner writes at least one stream and so a stream count bounds the cohort from above.
        #
        # `has_data` is kept deliberately, and costs nothing: zero people is not a person. Without
        # it a wrong `run_dir` and a small class are one indistinguishable message, and they need
        # opposite actions — fix the path, or accept the floor.
        return {"status": "suppressed", "min_learners": min_learners, "has_data": learners > 0,
                "reason": (f"no telemetry streams found under {run_dir} — check the path"
                           if learners == 0 else
                           f"k-anonymity floor: a class report needs at least {min_learners} "
                           f"learners IN EVERY LESSON and this run has fewer in at least one. "
                           f"Per-concept numbers over a smaller cohort could re-identify "
                           f"individuals; the size is withheld for the same reason. A "
                           f"pseudonym is salted per lesson, so a union across lessons counts "
                           f"learner-lesson pairs and cannot lift a lesson over the floor.")}

    # R1, clause 1, where it bites hardest on this surface. The floor above is over the WHOLE
    # run; a concept is a population of its own, and a concept attempted by one learner
    # published that learner's accuracy, calibration gap, hint-reliance and mean time under a
    # concept's name — a per-student report reached by reading a class report carefully.
    concepts = []
    withheld_concepts = False
    for cid, a in by_concept.items():
        if not a["attempts"]:
            continue  # hints only: no answer, nothing to report or withhold
        concept_population = _population(a["attempting"], rule)
        if concept_population.below_floor(min_learners):
            withheld_concepts = True
            continue
        figures, withheld_figures = _concept_figures(a, rule, min_learners)
        withheld_concepts = withheld_concepts or bool(withheld_figures)
        concepts.append({
            "concept": cid,
            "n_attempts": a["attempts"],
            "n_measured": a["measured"],
            **figures,
            "withheld_figures": withheld_figures,
            # The band, not the count: an exact contributor count per concept moves once per
            # contributor and is read against the roster the teacher holds.
            "cohort_band": cohort_band(concept_population.size, min_learners),
        })
    # surface the concepts most in need of re-teaching: low accuracy (unmeasured last), then high
    # hint-reliance, then the concept id — the MCP report's order.
    concepts.sort(key=lambda x: (2 if x["accuracy"] is None else x["accuracy"],
                                 -(x["hint_reliance"] or 0), x["concept"]))

    completion = _population(completion_members, rule)
    return {
        "status": "ok",
        # Participation counts, exact by call 1 of INT-STUDIUM-030 — but named, which is the
        # whole of R1's first clause: this is a count of X, arrived at by rule Y. Across more
        # than one lesson the members are learner-lesson pairs, and the payload changes the
        # KEY rather than the value: a pair count published as `n_learners` is the mislabelling
        # R1 exists to stop, and the Observatory's sessions column names the same two things
        # the same two ways.
        "n_learners": learners if population.n_lessons <= 1 else None,
        "n_learner_lesson_pairs": None if population.n_lessons <= 1 else learners,
        "n_lessons": population.n_lessons,
        "n_streams": len(streams),
        "identity_rule": rule,
        "identity_rule_note": _RULES[rule],
        "cohort_counts": population.counts_note,
        "lesson_scope": ("as named by the events (lesson_id)" if named_lessons == {True}
                         else "the whole run, taken as one lesson: no event names a lesson_id "
                              "and this report maps its scenes from exactly one bundle"),
        "completion_rate": round(n_completed / n_started, 3) if n_started else None,
        "completion_cohort": completion.judgement(min_learners),
        "mean_autonomy": round(statistics.mean(autonomy), 3) if autonomy else None,
        # `mean_autonomy` is a judgement metric: it says how a group worked, not what it got
        # right, and it names its own population rather than the run's.
        "autonomy_cohort": _judgement(autonomy_members, rule, min_learners),
        "universe_escalations": escalations,
        "top_adaptation_rules": rule_counts.most_common(6),
        "concepts": concepts,
        # A flag, never a count. How many concepts were withheld is monotone in the size of
        # the class and reads against a roster (the R1 lesson: a count moved to a neighbouring
        # key, or into the prose, is the same count).
        "withheld_below_floor": withheld_concepts,
        "reteach_priority": [c["concept"] for c in concepts
                             if c["accuracy"] is not None and c["accuracy"] < 0.8][:5],
        "trust_calibration": _trust_section(trust_by_scene, s2c, rule, min_learners),
        "non_attribution": NON_ATTRIBUTION,
    }


def _concept_figures(a: dict, rule: str, floor: int) -> tuple[dict, list[str]]:
    """One concept's figures, each over its own population and None below the floor, plus the names
    of the figures held back for that reason (an empty population is not measured, not withheld).
    A figure is published by the row's own rule, `Population.below_floor`: per lesson, because a
    union across lessons counts learner-lesson pairs and cannot lift one lesson over the floor.
    Same rules as `figures` in apps/lesson-mcp/src/teacher-tools.ts (one bundle there)."""
    def state(members: set) -> str:
        if not members:
            return "empty"
        return "withheld" if _population(members, rule).below_floor(floor) else "published"

    def size(members: set) -> int:
        return _population(members, rule).size if members else 0

    measured, rated, timed = state(a["measured_by"]), state(a["rated_by"]), state(a["timed_by"])
    attempting = size(a["attempting"])
    hinted = size(a["hinted_by"] & a["attempting"])
    rated_n = a["rated_n"]
    figures = {
        "accuracy": round(a["correct"] / a["measured"], 3) if measured == "published" else None,
        # learners who asked for a hint over learners who answered: a share of people, in [0, 1]
        "hint_reliance": round(hinted / attempting, 3) if attempting else None,
        # + = over-confident, over RATED answers only (I-5)
        "calibration_gap": (round(a["rated_conf_sum"] / rated_n - a["rated_correct"] / rated_n, 3)
                            if rated == "published" else None),
        "overconfidence_rate": round(a["overconfident"] / rated_n, 3) if rated == "published" else None,
        "mean_time_s": round(a["time_ms"] / a["timed"] / 1000, 1) if timed == "published" else None,
    }
    # Names only, never a count: which figures a population too small held back, so the report can
    # say "withheld" rather than "not measured" for a figure that was measured.
    withheld = [name for name, st in (("accuracy", measured), ("calibration_gap", rated),
                                      ("overconfidence_rate", rated), ("mean_time_s", timed))
                if st == "withheld"]
    return figures, withheld


def _trust_section(trust_by_scene: dict[str, dict], s2c: dict, rule: str,
                   min_learners: int) -> dict:
    """Class-level trust-calibration over grounded spot_the_flaw audits, mirroring
    the collector's compute_trust_calibration (same helpers, same bands, same floor). Returns
    an explicit not-measured shape when the run carries no grounded audits — an absent
    number must read as "not measured here", never as "no trust issues".

    R1: a scene is dropped before its numbers reach the overall mean, not merely before they
    reach the table. Over-trust is the most characterological reading this instrument
    produces, and a mean over two scenes where one had a single auditor is half that
    auditor's judgement published as the class's."""
    scenes = []
    gaps = []
    withheld = False
    population = Population()
    for sid, c in sorted(trust_by_scene.items()):
        if c["planted"] <= 0:
            continue
        scene_population = _population(c["members"], rule)
        if scene_population.below_floor(min_learners):
            withheld = True
            continue
        population.merge(scene_population)
        over_trust = c["missed"] / c["planted"]
        over_distrust = _over_distrust_rate(c["fp"], c["sound"])
        gap = max(-1.0, min(1.0, over_trust - (over_distrust or 0.0)))
        gaps.append(gap)
        scenes.append({
            "scene": s2c.get(sid, sid), "gap": round(gap, 3),
            "over_trust": round(over_trust, 3),
            "over_distrust": None if over_distrust is None else round(over_distrust, 3),
            "planted": c["planted"], "missed": c["missed"], "false_positives": c["fp"],
            "cohort_band": cohort_band(scene_population.size, min_learners),
        })
    if not gaps or population.below_floor(min_learners):
        return {"measured": False, "n_scenes": 0, "withheld_below_floor": withheld,
                "scenes": scenes,
                "note": ("trust calibration was measured but is not published: the learners "
                         "who audited these scenes are fewer than the floor in at least one "
                         "lesson" if withheld or gaps else
                         "no grounded audits in this run — trust calibration NOT measured"),
                **population.judgement(min_learners)}
    overall = sum(gaps) / len(gaps)
    band = "bien" if abs(overall) <= TRUST_WELL_BAND else ("sur" if overall > 0 else "sous")
    # n_scenes counts the PUBLISHED scenes: a tally including the withheld ones would
    # republish the number `withheld_below_floor` replaced.
    return {"measured": True, "n_scenes": len(gaps), "gap": round(overall, 3),
            "band": band, "scenes": scenes, "withheld_below_floor": withheld,
            **population.judgement(min_learners)}


def _md(rep: dict) -> str:
    if rep.get("status") != "ok":
        return f"# Class report — SUPPRESSED\n\n{rep.get('reason')}"
    L = ["# Class report (aggregate, RGPD-safe — no individual records)", ""]
    cohort = (f"learners: {rep['n_learners']}" if rep["n_learners"] is not None
              else f"learner-lesson pairs: {rep['n_learner_lesson_pairs']}")
    L.append(f"{cohort} (over {rep['n_streams']} telemetry stream(s), "
             f"{rep['n_lessons']} lesson(s)) · "
             f"completion: {rep['completion_rate']} · "
             f"mean {AUTONOMY_INDICATOR_NAME}: {rep['mean_autonomy']} · "
             f"universe escalations: {rep['universe_escalations']}")
    L.append("")
    # R1: the rule that produced the cohort, on the page, in the reader's words. A count whose
    # rule is not stated is a count the reader has to guess the meaning of, and the two
    # possible meanings here — people, or learner-lesson pairs — differ by the size of the
    # class.
    L.append(f"*Counted by*: {rep['identity_rule_note']}. Lessons: {rep['lesson_scope']}. "
             f"These are {rep['cohort_counts']}.")
    L.append("")
    if rep["n_learners"] is None:
        L.append("> A pseudonym is HMAC(learnerId:lessonId), so the same person holds a "
                 "different one in every lesson: the number above counts learner-lesson "
                 "pairs and is NOT a headcount of the class.")
        L.append("")
    L.append(f"*{AUTONOMY_INDICATOR_NAME}*: per session, scenes completed / (scenes completed + "
             "scaffolding), averaged over the sessions in this run. The collector's course-level "
             f"*{_COLLECTOR_AUTONOMY_NAME}* is a different measurement under the same wire key.")
    L.append("")
    L.append("## Concepts (worst first — candidates to re-teach)")
    L.append("| concept | cohort | answers | graded | accuracy | hint-reliance | calibration gap | overconf. | mean time (s) |")
    L.append("|---|:-:|--:|--:|--:|--:|--:|--:|--:|")

    def shown(c: dict, key: str, signed: bool = False) -> str:
        # None is "not measured" — or, when the figure was measured over fewer learners than the
        # floor, "withheld" — never 0.
        value = c[key]
        if value is None:
            return ("withheld (fewer than k)" if key in c.get("withheld_figures", ())
                    else "not measured")
        return f"{value:+}" if signed else f"{value}"

    for c in rep["concepts"]:
        L.append(f"| {c['concept']} | {c['cohort_band']} | {c['n_attempts']} | {c['n_measured']} | "
                 f"{shown(c, 'accuracy')} | {shown(c, 'hint_reliance')} | "
                 f"{shown(c, 'calibration_gap', signed=True)} | {shown(c, 'overconfidence_rate')} | "
                 f"{shown(c, 'mean_time_s')} |")
    if rep["withheld_below_floor"]:
        L.append("")
        L.append("> At least one concept or figure is not shown: fewer learners contributed to it "
                 "than the floor allows. How many were withheld is not stated — that number grows "
                 "with the class and can be read against the list of names you hold.")
    L.append("")
    L.append("## Trust calibration (judgment over real artifacts)")
    tc = rep.get("trust_calibration") or {}
    if not tc.get("measured"):
        L.append(tc.get("note", "not measured"))
    else:
        L.append(f"overall gap: {tc['gap']:+} ({tc['band']}) over {tc['n_scenes']} published "
                 f"grounded scene(s), cohort {tc['cohort_band']} "
                 "— + credulous (missed planted flaws), − skeptical (flagged sound claims)")
        L.append("")
        L.append("| scene/concept | cohort | gap | over-trust | over-distrust | planted | missed | false pos. |")
        L.append("|---|:-:|--:|--:|--:|--:|--:|--:|")
        for s in tc["scenes"]:
            od = "n/m" if s["over_distrust"] is None else f"{s['over_distrust']}"
            L.append(f"| {s['scene']} | {s['cohort_band']} | {s['gap']:+} | {s['over_trust']} | {od} | "
                     f"{s['planted']} | {s['missed']} | {s['false_positives']} |")
        if tc.get("withheld_below_floor"):
            L.append("")
            L.append("> At least one audited scene is not shown, and did not enter the overall "
                     "gap either: too few learners audited it.")
    L.append("")
    L.append(f"**Re-teach priority:** {', '.join(rep['reteach_priority']) or '(none — class above 0.8)'}")
    L.append(f"\n**Top adaptations fired:** {rep['top_adaptation_rules']}")
    L.append("\n> Calibration gap > 0 = class over-confident on that concept, over the answers learners "
             "rated (an unrated answer is left out). Accuracy counts only answers a key or a model judge "
             "graded; a keyword score is an answer, not a grade. No learner is named; individual "
             "mastery records never leave the learner's device.")
    L.append(f"\n> {rep['non_attribution']}.")
    return "\n".join(L)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="RGPD-safe class analytics over Studium telemetry")
    ap.add_argument("run_dir")
    ap.add_argument("--min-learners", type=int, default=MIN_LEARNERS_DEFAULT,
                    help=f"k-anonymity floor over DISTINCT learners "
                         f"(default {MIN_LEARNERS_DEFAULT})")
    ap.add_argument("--out", default=None)
    ap.add_argument("--bundle", default=None,
                    help="the lesson: a lesson.json, a lesson folder or a *-bundle.zip. Needed in the durable "
                         "layout, where no bundle sits next to the telemetry; without it concept rows are "
                         "named by scene id")
    args = ap.parse_args(argv)
    bundle = Path(args.bundle).resolve() if args.bundle else None
    if not _scene_to_concept(Path(args.run_dir).resolve(), bundle):
        why = ("the lesson given with --bundle could not be read" if bundle
               else "no *-bundle.zip sits next to the telemetry")
        print(f"class_report: {why}, so the rows are named by scene id, not by concept; "
              "pass --bundle path/to/lesson.json (a lesson.json, a lesson folder or a bundle .zip) "
              "to name the concepts", file=sys.stderr)
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
