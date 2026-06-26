"""Tests for tools/class_report.py — the teacher class-analytics aggregator, focused on the
critique_submitted fold-in (ai_critique / spot_the_flaw / explain_back) added with the active-learning
scenes. Run: .venv/bin/python -m pytest tools/test_class_report.py -q
"""
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
