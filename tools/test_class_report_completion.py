"""tools/class_report.py: completion over distinct learners, not over `lesson_started` events
(audit 2026-11-10, follow-up to D3). A resumed learner writes `lesson_started` twice.

Run: .venv/bin/python -m pytest tools/test_class_report_completion.py -q
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from class_report import build_report  # noqa: E402


def _ev(learner, n, body):
    return {"event_id": f"{learner}-{n}", "learner_pseudonym": f"hmac:{learner}", "lesson_id": "demo",
            "bundle_version": "unversioned", "client_timestamp": "2026-11-10T09:00:00Z", **body}


def _write(run_dir, learner, bodies):
    d = run_dir / learner / "demo"
    d.mkdir(parents=True, exist_ok=True)
    (d / "telemetry.jsonl").write_text(
        "\n".join(json.dumps(_ev(learner, n, b)) for n, b in enumerate(bodies)) + "\n", encoding="utf-8")


def _bundle(tmp_path):
    p = tmp_path / "lesson.json"
    p.write_text(json.dumps({"scenes": [{"id": "q", "concept_refs": ["c"]}]}), encoding="utf-8")
    return p


START = {"type": "lesson_started", "bundle_uri": "x"}
DONE = {"type": "lesson_completed", "total_duration_ms": 1, "autonomy_ratio": 1.0}
ANSWER = {"type": "quiz_answered", "scene_id": "q", "item_id": "i", "correct": True, "response_time_ms": 1}


def test_start_resume_start_complete_counts_one_of_one(tmp_path):
    run = tmp_path / "data"
    _write(run, "a", [START, ANSWER, START, DONE])
    rep = build_report(run, min_learners=1, bundle_path=_bundle(tmp_path))
    assert rep["completion_rate"] == 1.0


def test_a_learner_who_resumed_twice_and_never_finished_counts_once(tmp_path):
    run = tmp_path / "data"
    _write(run, "a", [START, ANSWER, DONE])
    _write(run, "b", [START, ANSWER, START, START])
    rep = build_report(run, min_learners=2, bundle_path=_bundle(tmp_path))
    assert rep["completion_rate"] == 0.5
