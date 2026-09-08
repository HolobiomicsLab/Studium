"""Unit tests for course_completion (class-level course-spine funnel).

A teacher-facing CLASS-LEVEL funnel over the course spine: for each lesson, how
many DISTINCT learners completed it (from `lesson_completed` telemetry). The
join key is lesson_id (== bundle_id, stamped on every event).

HONESTY BOUNDARY (asserted): the telemetry `learner_pseudonym` is salted by
bundle_id, so the SAME human has a DIFFERENT pseudonym in each lesson. Distinct
counts are therefore valid WITHIN a lesson, but per-individual cross-lesson
paths (did learner X who finished A go on to finish B?) are NOT recoverable from
telemetry by design — that identity lives only in the profile store. This funnel
makes no per-individual cross-lesson claim.
"""

import json
from pathlib import Path

from metrics import compute_course_completion


def _base(idx=0, pseudo="hmac:learner0", lesson="l1"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": lesson,
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-06-28T10:00:00Z",
    }


def _completed(idx, lesson, pseudo):
    return {
        **_base(idx, pseudo=pseudo, lesson=lesson),
        "type": "lesson_completed",
        "total_duration_ms": 1000,
        "autonomy_ratio": 0.8,
    }


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-06-28.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def test_distinct_completers_per_lesson(tmp_path):
    events = [
        _completed(0, "l1", "hmac:a"),
        _completed(1, "l1", "hmac:b"),
        _completed(2, "l2", "hmac:a"),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_course_completion(data_dir, "c1")
    assert r["lessons"]["l1"]["n_completed"] == 2
    assert r["lessons"]["l2"]["n_completed"] == 1
    assert r["total_completions"] == 3


def test_duplicate_completion_same_learner_counts_once(tmp_path):
    """A re-completion by the same (bundle-scoped) pseudonym is one distinct learner."""
    events = [
        _completed(0, "l1", "hmac:a"),
        _completed(1, "l1", "hmac:a"),  # same learner, replayed
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_course_completion(data_dir, "c1")
    assert r["lessons"]["l1"]["n_completed"] == 1
    assert r["total_completions"] == 2  # but both events counted in the raw total


def test_no_completions_empty(tmp_path):
    events = [{**_base(0), "type": "scene_completed", "scene_id": "s1", "duration_ms": 0, "success": True}]
    data_dir = _write_events(tmp_path, "c1", events)
    r = compute_course_completion(data_dir, "c1")
    assert r["lessons"] == {}
    assert r["total_completions"] == 0


def test_missing_lesson_id_skipped(tmp_path):
    ev = _completed(0, "l1", "hmac:a")
    del ev["lesson_id"]
    data_dir = _write_events(tmp_path, "c1", [ev])
    r = compute_course_completion(data_dir, "c1")
    assert r["lessons"] == {}
    assert r["total_completions"] == 0


def test_bundle_version_filter(tmp_path):
    e0 = _completed(0, "l1", "hmac:a")
    e1 = _completed(1, "l1", "hmac:b")
    e1["bundle_version"] = "2.0.0"
    data_dir = _write_events(tmp_path, "c1", [e0, e1])
    r = compute_course_completion(data_dir, "c1", bundle_version="1.0.0")
    assert r["lessons"]["l1"]["n_completed"] == 1
    assert r["total_completions"] == 1
