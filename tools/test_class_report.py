"""Tests for tools/class_report.py — the teacher class-analytics aggregator, focused on the
critique_submitted fold-in (ai_critique / spot_the_flaw / explain_back) added with the active-learning
scenes. Run: .venv/bin/python -m pytest tools/test_class_report.py -q
"""
import inspect
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from class_report import build_report  # noqa: E402


def _bundle(tmp_path):
    """A 3-scene bundle: a pure-quiz concept, and a concept mixing a quiz + a critique scene."""
    b = {
        "scenes": [
            {"id": "q-quiz", "concept_refs": ["c-quiz"]},      # pure-quiz concept
            {"id": "q-mixed", "concept_refs": ["c-mixed"]},    # quiz part of the mixed concept
            {"id": "cr-mixed", "concept_refs": ["c-mixed"]},   # critique part of the mixed concept
            {"id": "cr-crit", "concept_refs": ["c-crit"]},     # critique-only concept
        ]
    }
    p = tmp_path / "lesson.json"
    p.write_text(json.dumps(b), encoding="utf-8")
    return p


def _write_learner(run_dir, learner, events):
    d = run_dir / "sessions" / learner
    d.mkdir(parents=True, exist_ok=True)
    (d / "telemetry.jsonl").write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")


def _events():
    return [
        {"type": "lesson_started"},
        # pure-quiz concept: correct, self-rated confidence 0.5, 5s
        {"type": "quiz_answered", "scene_id": "q-quiz", "correct": True, "confidence": 0.5, "response_time_ms": 5000},
        # mixed concept: a quiz (correct, 5s) + a passing critique (no time)
        {"type": "quiz_answered", "scene_id": "q-mixed", "correct": True, "confidence": 0.5, "response_time_ms": 5000},
        {"type": "critique_submitted", "scene_id": "cr-mixed", "llm_score": 0.8, "completion_rate": 1.0},
        # critique-only concept: passing critique
        {"type": "critique_submitted", "scene_id": "cr-crit", "llm_score": 0.9, "completion_rate": 1.0},
        {"type": "lesson_completed", "autonomy_ratio": 1.0},
    ]


def test_critique_foldin_calibration_and_time(tmp_path):
    bundle = _bundle(tmp_path)
    for learner in ("alice", "bob"):
        _write_learner(tmp_path, learner, _events())

    rep = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    assert rep["status"] == "ok"
    by = {c["concept"]: c for c in rep["concepts"]}

    # the critique scene rolls into per-concept accuracy (llm_score >= 0.6 == correct)
    assert "c-crit" in by and "c-mixed" in by
    assert by["c-crit"]["n_attempts"] == 2 and by["c-crit"]["accuracy"] == 1.0

    # AR-1: critique items are CALIBRATION-NEUTRAL (conf_sum gets the binary pass, not the raw score),
    # so a critique-only concept has gap exactly 0 — a raw-score fold-in would have given -0.1/-0.2.
    assert by["c-crit"]["calibration_gap"] == 0.0
    # the pure-quiz concept keeps its real miscalibration (conf 0.5 vs accuracy 1.0)
    assert by["c-quiz"]["calibration_gap"] == -0.5

    # AR-3: mean_time_s divides by TIMED (quiz) attempts only — the no-time critique must not dilute it.
    # c-mixed has 1 quiz @5s + 1 critique per learner → 5.0s, not 2.5s.
    assert by["c-mixed"]["n_attempts"] == 4
    assert by["c-mixed"]["mean_time_s"] == 5.0


def test_k_anonymity_suppression(tmp_path):
    bundle = _bundle(tmp_path)
    _write_learner(tmp_path, "solo", _events())
    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["status"] == "suppressed"


def test_a_suppressed_report_does_not_name_the_size_of_the_cohort_it_protects(tmp_path):
    """INT-STUDIUM-030. The floor withholds numbers computed over too few learners — and then
    the suppression itself published the exact count, so the ONLY cohorts whose size this
    report stated exactly were the ones the floor exists to protect. A class of twenty is
    reported as an aggregate; a class of two was reported as *two*.

    `n_streams` is the same leak by another route: every learner writes at least one stream, so
    a stream count is an upper bound on the cohort, and `n_streams == 1` names a single person.
    """
    bundle = _bundle(tmp_path)
    for learner in ("p-1", "p-2"):
        _write_learner(tmp_path, learner, _events())

    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["status"] == "suppressed"
    assert "n_learners" not in rep, "the suppressed path still publishes the cohort size"
    assert "n_streams" not in rep, "a stream count bounds the cohort from above"
    # nor in the prose a teacher actually reads
    assert "2" not in rep["reason"], rep["reason"]
    assert str(rep["min_learners"]) in rep["reason"]


def test_an_empty_run_is_distinguishable_from_a_small_class(tmp_path):
    """The repair must not delete a real signal to hide a number (the symmetric-guard trap).

    An operator whose path is wrong and a teacher whose class is too small both get
    `suppressed`, and they need entirely different actions — fix the path, or accept the floor.
    Saying so costs no privacy: zero people is not a person. Anything above zero is reported
    only as being below the floor.
    """
    bundle = _bundle(tmp_path)
    empty = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert empty["status"] == "suppressed" and empty["has_data"] is False

    _write_learner(tmp_path, "solo", _events())
    small = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert small["status"] == "suppressed" and small["has_data"] is True
    assert empty["reason"] != small["reason"]
    assert "1" not in small["reason"], small["reason"]


def test_trust_section_not_measured_without_grounded_audits(tmp_path):
    bundle = _bundle(tmp_path)
    for learner in ("a", "b"):
        _write_learner(tmp_path, learner, _events())
    rep = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    tc = rep["trust_calibration"]
    assert tc["measured"] is False
    assert "NOT measured" in tc["note"]


def test_trust_section_matches_the_engine_denominators(tmp_path):
    """The probe case the collector fix was verified on: planted=2, missed=0, fp=6,
    sound=8 must yield gap -0.75 ('sous') — over_distrust normalised by the SOUND
    population, exactly like packages/learner-state recordJudgmentAudit."""
    bundle = _bundle(tmp_path)
    audit = {"type": "ai_audit_result", "scene_id": "cr-crit", "planted_errors": 1,
             "true_positives": 1, "false_positives": 3, "missed": 0, "sound_total": 4}
    for learner in ("a", "b"):
        _write_learner(tmp_path, learner, _events() + [audit])
    rep = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    tc = rep["trust_calibration"]
    assert tc["measured"] is True and tc["n_scenes"] == 1
    # pooled across 2 learners: planted=2, missed=0, fp=6, sound=8 -> 0 - 6/8 = -0.75
    assert tc["gap"] == -0.75 and tc["band"] == "sous"
    scene = tc["scenes"][0]
    assert scene["over_distrust"] == 0.75 and scene["over_trust"] == 0.0
    assert scene["scene"] == "c-crit"


# ---------------------------------------------------------------------------
# INT-STUDIUM-019 — the k floor counts learners, not files (closes INT-STUDIUM-005's
# single-definition half: MIN_LEARNERS_DEFAULT is the one place the value lives).
# ---------------------------------------------------------------------------

def _write_stream(run_dir, rel_dir, events):
    """Write one telemetry stream at an arbitrary layout under the run directory."""
    d = run_dir / rel_dir
    d.mkdir(parents=True, exist_ok=True)
    (d / "telemetry.jsonl").write_text("\n".join(json.dumps(e) for e in events), encoding="utf-8")


def _pseudonymized(pseudonym):
    return [dict(e, learner_pseudonym=pseudonym) for e in _events()]


def test_k_floor_counts_distinct_pseudonyms_not_streams(tmp_path):
    """The durable host layout writes one stream per (pseudonym, bundle): three files can be
    two learners. Counting files reported a cohort larger than it is, which is the wrong side
    of a privacy floor to be wrong on."""
    bundle = _bundle(tmp_path)
    _write_stream(tmp_path, "data/p-1/bundle-a", _pseudonymized("p-1"))
    _write_stream(tmp_path, "data/p-1/bundle-b", _pseudonymized("p-1"))
    _write_stream(tmp_path, "data/p-2/bundle-a", _pseudonymized("p-2"))

    # Three files, two people: a floor of 3 must suppress. Counting files would have passed it.
    rep = build_report(tmp_path, min_learners=3, bundle_path=bundle)
    assert rep["status"] == "suppressed"
    assert "3" in rep["reason"]            # the floor, which is all a suppressed report may state

    ok = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    assert ok["status"] == "ok" and ok["n_learners"] == 2 and ok["n_streams"] == 3
    # No event here names a lesson, so the run is one lesson and the report says which of the
    # two things it did (INT-STUDIUM-030 R1: the rule that counted is published, not implied).
    assert "taken as one lesson" in ok["lesson_scope"]


def test_the_floor_is_per_lesson_and_a_union_across_lessons_cannot_lift_it(tmp_path):
    """R1, clause 3, where the events name their lessons — which every ADR-006 event does
    (`lesson_id` is required on the base model), so this is the case that runs in production.

    Four people, two in each of two lessons. A union counts four members and would clear a
    floor of three; those are learner-lesson pairs, and no lesson has three people in it."""
    bundle = _bundle(tmp_path)
    for lesson, pseudonyms in (("l1", ("p-1", "p-2")), ("l2", ("p-3", "p-4"))):
        for pseudonym in pseudonyms:
            events = [dict(e, lesson_id=lesson) for e in _pseudonymized(pseudonym)]
            _write_stream(tmp_path, f"data/{pseudonym}/{lesson}", events)

    assert build_report(tmp_path, min_learners=3, bundle_path=bundle)["status"] == "suppressed"

    ok = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    assert ok["status"] == "ok" and ok["n_lessons"] == 2
    # Two lessons, so the members are learner-lesson pairs — and the payload says so by
    # changing the KEY, not by publishing a pair count under the word "learners".
    assert ok["n_learners"] is None and ok["n_learner_lesson_pairs"] == 4
    assert ok["cohort_counts"] == "learner-lesson pairs across the lessons in scope"
    assert ok["lesson_scope"] == "as named by the events (lesson_id)"


def test_a_run_that_mixes_named_and_unnamed_lessons_is_refused(tmp_path):
    """Clause 2 again, one level down. Counting both under one key would put events from
    different lessons into one population — the thing the per-lesson floor exists to stop."""
    bundle = _bundle(tmp_path)
    _write_stream(tmp_path, "data/p-1/l1",
                  [dict(e, lesson_id="l1") for e in _pseudonymized("p-1")])
    _write_stream(tmp_path, "data/p-2/l1", _pseudonymized("p-2"))

    rep = build_report(tmp_path, min_learners=1, bundle_path=bundle)
    assert rep["status"] == "suppressed"
    assert "some carry a lesson_id and some do not" in rep["reason"]


def test_streams_without_a_pseudonym_still_count_one_learner_each(tmp_path):
    """The eval layout (sessions/<persona>/telemetry.jsonl) carries no pseudonym; each stream
    stays one learner there, so the floor does not silently tighten on existing runs."""
    bundle = _bundle(tmp_path)
    for learner in ("alice", "bob", "carol"):
        _write_learner(tmp_path, learner, _events())
    rep = build_report(tmp_path, min_learners=3, bundle_path=bundle)
    assert rep["status"] == "ok" and rep["n_learners"] == 3 and rep["n_streams"] == 3


def test_min_learners_default_is_one_named_constant(tmp_path):
    """One definition: the signature default and the CLI default are the same object, so the
    product owner's RGPD value is changed in one place (INT-STUDIUM-005)."""
    import class_report

    assert class_report.MIN_LEARNERS_DEFAULT == 5
    sig = inspect.signature(build_report).parameters["min_learners"].default
    assert sig == class_report.MIN_LEARNERS_DEFAULT

    # the CLI default is the constant too: four learners are below it without a flag
    bundle = _bundle(tmp_path)
    for learner in ("a", "b", "c", "d"):
        _write_learner(tmp_path, learner, _events())
    out = tmp_path / "out"
    assert class_report.main([str(tmp_path), "--bundle", str(bundle), "--out", str(out)]) == 0
    assert json.loads((out / "class_report.json").read_text())["status"] == "suppressed"
    assert class_report.main([str(tmp_path), "--bundle", str(bundle),
                              "--min-learners", "4", "--out", str(out)]) == 0
    assert json.loads((out / "class_report.json").read_text())["status"] == "ok"


def test_the_report_names_the_ratio_it_averages_and_keeps_its_json_key(tmp_path):
    """INT-STUDIUM-023: two measurements ship under the wire key `autonomy_ratio`.

    This report averages the runtime's: scenes completed over scenes completed plus
    scaffolding, computed on the device for one session. The collector computes a different
    one under the same key — AI critiques over critiques plus hints, over a course's events.
    The key does not move (the Observatory's sessions column reads `mean_autonomy`, and
    historical streams carry `autonomy_ratio`), so what tells the two apart is the name the
    teacher reads.
    """
    import class_report
    import metrics

    assert class_report.AUTONOMY_INDICATOR_NAME != metrics.AUTONOMY_INDICATOR_NAME

    bundle = _bundle(tmp_path)
    for learner in ("a", "b", "c", "d", "e"):
        _write_learner(tmp_path, learner, _events())
    out = tmp_path / "out"
    assert class_report.main([str(tmp_path), "--bundle", str(bundle), "--out", str(out)]) == 0

    # the key its consumers read has not moved
    assert json.loads((out / "class_report.json").read_text())["mean_autonomy"] == 1.0
    md = (out / "class_report.md").read_text()
    assert class_report.AUTONOMY_INDICATOR_NAME in md
    assert "mean autonomy" not in md  # the name that meant two things


def test_the_floor_is_documented_as_a_restraint_not_as_anonymity():
    """INT-STUDIUM-030 — the floor stays at five and stops promising what five cannot buy.

    k-anonymity protects a population from a reader who does not know it. This deployment's
    reader is a teacher who already holds the roster, so five pseudonyms behind a number are
    five people they can usually name. The module used to say the floor "refuses to report when
    too few learners would make a concept-level number re-identifiable" — a guarantee the class
    deployment cannot deliver, and one that is worse than none precisely because it is relied
    upon. What it delivers is that the instrument does not become a per-student report.

    The number is untouched; only the claim is. So this pins the CLAIM, and pins that the floor
    is still five, because a correction that quietly weakened the restraint would pass a test
    that only read the prose.
    """
    import class_report

    doc = class_report.__doc__ or ""
    assert "RESTRAINT ON SINGLING OUT" in doc
    assert "not a guarantee\n    of anonymity" in doc
    assert "re-identifiable" not in doc, "the withdrawn guarantee is back in the docstring"
    assert class_report.MIN_LEARNERS_DEFAULT == 5, "the claim changed, the floor must not"


# ---------------------------------------------------------------------------
# INT-STUDIUM-030 R1 (stage 2) — every published number names the population it was
# computed over, that population is counted by exactly one rule, and the rule operates
# inside one lesson.
# ---------------------------------------------------------------------------

def _quiz(scene, learner, correct=True):
    return [
        {"type": "lesson_started", "learner_pseudonym": learner},
        {"type": "quiz_answered", "scene_id": scene, "correct": correct,
         "confidence": 0.5, "response_time_ms": 5000, "learner_pseudonym": learner},
        {"type": "lesson_completed", "autonomy_ratio": 1.0, "learner_pseudonym": learner},
    ]


def test_a_concept_attempted_by_one_learner_is_not_published(tmp_path):
    """THE defect this stage exists for, on the surface a teacher actually reads.

    The floor was applied once, over the whole run. Inside a class that clears it, a concept
    attempted by a single learner published that learner's accuracy, calibration gap,
    hint-reliance and mean time under the concept's name — a per-student report reached by
    reading a class report carefully. `fixtures/atomistique-l1/GUIDE-TEST-ELISE.md` promises
    the teacher this document is aggregate; this is the assertion behind that sentence.
    """
    bundle = _bundle(tmp_path)
    for i in range(5):
        _write_learner(tmp_path, f"L{i}", _quiz("q-quiz", f"p{i}"))
    _write_learner(tmp_path, "solo", _quiz("q-mixed", "p-solo"))

    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["status"] == "ok"
    assert [c["concept"] for c in rep["concepts"]] == ["c-quiz"]
    assert rep["withheld_below_floor"] is True


def test_every_published_concept_names_its_own_cohort_as_a_band(tmp_path):
    bundle = _bundle(tmp_path)
    for i in range(12):
        _write_learner(tmp_path, f"L{i}", _quiz("q-quiz", f"p{i}"))

    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert [c["cohort_band"] for c in rep["concepts"]] == ["10–19"]
    assert rep["identity_rule"] == "pseudonym"
    assert rep["cohort_counts"] == "distinct learners within one lesson"


def test_the_withheld_flag_does_not_encode_how_many(tmp_path):
    """One withheld concept and three produce the same payload — including the prose, which
    is where the count survived the first time this repair was made (INT-STUDIUM-030 R1 on the
    Observatory: a count moved into a sentence is the same count)."""
    bundle = _bundle(tmp_path)

    def report(extra_scenes):
        run = tmp_path / f"run{len(extra_scenes)}"
        for i in range(5):
            _write_learner(run, f"L{i}", _quiz("q-quiz", f"p{i}"))
        for n, scene in enumerate(extra_scenes):
            _write_learner(run, f"solo{n}", _quiz(scene, f"p-solo{n}"))
        return build_report(run, min_learners=5, bundle_path=bundle)

    one = report(["q-mixed"])
    three = report(["q-mixed", "cr-mixed", "cr-crit"])
    assert one["concepts"] == three["concepts"]
    assert one["withheld_below_floor"] == three["withheld_below_floor"] is True
    assert not [k for k in one if k.startswith("n_withheld")]


def test_a_mixed_directory_is_refused_rather_than_summed(tmp_path):
    """R1 clause 2, and the line this replaces: `learner_ids |= stream_ids or {stream}`. Where
    some streams carried a pseudonym and some did not, the union was part people and part
    files — a number with no definition, to which the floor was then applied."""
    bundle = _bundle(tmp_path)
    for i in range(5):
        _write_learner(tmp_path, f"L{i}", _quiz("q-quiz", f"p{i}"))
    _write_learner(tmp_path, "anon", [dict(e) for e in _events()])   # no learner_pseudonym

    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["status"] == "suppressed"
    assert "part people and part files" in rep["reason"], rep["reason"]


def test_the_eval_layout_still_counts_one_stream_one_learner(tmp_path):
    """The other rule, unchanged: a directory where NO stream carries a pseudonym is counted
    by streams, and says so. The repair refuses the MIXED case, not the second rule."""
    bundle = _bundle(tmp_path)
    for learner in ("alice", "bob", "carol", "dave", "erin"):
        _write_learner(tmp_path, learner, _events())

    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["status"] == "ok" and rep["n_learners"] == 5
    assert rep["identity_rule"] == "stream"
    assert "one telemetry stream, one learner" in rep["identity_rule_note"]


def test_the_judgement_vocabulary_is_the_collectors_own_objects(tmp_path):
    """One definition of the band, the floor and the non-attribution line, in the collector's
    `metrics`, shared by this report, the live endpoints and the Observatory page. Three
    copies of a sentence say three different things within a release or two — the TS/Py
    `over_distrust` drift is the precedent this repository already paid for."""
    import class_report
    import metrics

    assert class_report.NON_ATTRIBUTION is metrics.NON_ATTRIBUTION
    assert class_report.cohort_band is metrics.cohort_band
    assert class_report.MIN_LEARNERS_DEFAULT is metrics.MIN_LEARNERS

    bundle = _bundle(tmp_path)
    for i in range(5):
        _write_learner(tmp_path, f"L{i}", _quiz("q-quiz", f"p{i}"))
    rep = build_report(tmp_path, min_learners=5, bundle_path=bundle)
    assert rep["non_attribution"] is metrics.NON_ATTRIBUTION
    assert rep["autonomy_cohort"]["non_attribution"] is metrics.NON_ATTRIBUTION


def test_unrated_quiz_answers_are_calibration_neutral_and_not_overconfident(tmp_path):
    """I-5: quiz_answered.confidence is optional. An answer without it must not count as a 0.0
    confidence (that read as `underconfident` on every correct answer and shifted the gap); like a
    critique it contributes conf == accuracy, so the gap is 0 and neither tail counter moves."""
    bundle = _bundle(tmp_path)
    for learner in ("alice", "bob"):
        _write_learner(tmp_path, learner, [
            {"type": "lesson_started"},
            {"type": "quiz_answered", "scene_id": "q-quiz", "correct": True, "response_time_ms": 4000},
            {"type": "lesson_completed", "autonomy_ratio": 1.0},
        ])
    rep = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    assert rep["status"] == "ok"
    quiz = {c["concept"]: c for c in rep["concepts"]}["c-quiz"]
    assert quiz["n_attempts"] == 2 and quiz["accuracy"] == 1.0
    assert quiz["calibration_gap"] == 0.0
    assert quiz["overconfidence_rate"] == 0.0
    assert quiz["mean_time_s"] == 4.0


def test_a_wrong_unrated_answer_is_not_overconfident_either(tmp_path):
    bundle = _bundle(tmp_path)
    for learner in ("alice", "bob"):
        _write_learner(tmp_path, learner, [
            {"type": "quiz_answered", "scene_id": "q-quiz", "correct": False, "response_time_ms": 4000},
        ])
    rep = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    quiz = {c["concept"]: c for c in rep["concepts"]}["c-quiz"]
    assert quiz["calibration_gap"] == 0.0
    assert quiz["overconfidence_rate"] == 0.0
