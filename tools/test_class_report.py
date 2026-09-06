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
    assert rep["n_learners"] == 1


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

    rep = build_report(tmp_path, min_learners=3, bundle_path=bundle)
    assert rep["status"] == "suppressed"
    assert rep["n_learners"] == 2          # two people
    assert rep["n_streams"] == 3           # three files
    assert "3" in rep["reason"]

    ok = build_report(tmp_path, min_learners=2, bundle_path=bundle)
    assert ok["status"] == "ok" and ok["n_learners"] == 2 and ok["n_streams"] == 3


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
