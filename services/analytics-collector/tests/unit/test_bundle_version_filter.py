"""Unit tests for bundle_version filtering (M5.7).

- Events from 2 different bundle_versions
- Filter by bundle_version → only matching events count
- No filter → all events
- store.read_events_for_course helper parité
"""

import json
from pathlib import Path

from metrics import (
    compute_autonomy,
    compute_progress,
    compute_reasoning_depth_score,
)
from store import read_events_for_course


def _event(idx: int, bundle_version: str, **overrides) -> dict:
    base = {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx % 10}",
        "learner_pseudonym": f"hmac:l{idx}",
        "lesson_id": "demo",
        "bundle_version": bundle_version,
        "client_timestamp": "2026-05-09T10:00:00Z",
    }
    base.update(overrides)
    return base


def _seed(tmp_path: Path, course: str, events: list[dict]) -> None:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-09.jsonl").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n"
    )


# --- store.read_events_for_course ---------------------------------------

def test_read_events_for_course_filters_by_bundle_version(tmp_path):
    bv_a = "1.1:b1@t1"
    bv_b = "1.1:b1@t2"
    _seed(tmp_path, "course-x", [
        _event(0, bv_a, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(1, bv_a, type="scene_completed", scene_id="s1",
               duration_ms=10, success=False),
        _event(2, bv_b, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
    ])

    only_a = read_events_for_course(tmp_path, "course-x", bundle_version=bv_a)
    assert len(only_a) == 2
    assert all(e["bundle_version"] == bv_a for e in only_a)


def test_read_events_for_course_no_filter_returns_all(tmp_path):
    bv_a = "1.1:b1@t1"
    bv_b = "1.1:b1@t2"
    _seed(tmp_path, "course-x", [
        _event(0, bv_a, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(1, bv_b, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
    ])
    all_events = read_events_for_course(tmp_path, "course-x")
    assert len(all_events) == 2


def test_read_events_for_course_legacy_events_bucket_unversioned(tmp_path):
    """Events legacy sans champ bundle_version → bucketed sous "unversioned"."""
    legacy = {
        "event_id": "01923456-7890-1234-5678-abcdef012340",
        "learner_pseudonym": "hmac:l0",
        "lesson_id": "demo",
        "client_timestamp": "2026-05-09T10:00:00Z",
        "type": "scene_completed",
        "scene_id": "s1",
        "duration_ms": 10,
        "success": True,
    }
    _seed(tmp_path, "course-x", [legacy])

    only_unversioned = read_events_for_course(
        tmp_path, "course-x", bundle_version="unversioned",
    )
    assert len(only_unversioned) == 1


# --- compute_* parité ---------------------------------------------------

def test_filter_by_bundle_version_progress(tmp_path):
    bv_a = "1.1:b1@t1"
    bv_b = "1.1:b1@t2"
    _seed(tmp_path, "course-x", [
        _event(0, bv_a, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(1, bv_a, type="scene_completed", scene_id="s1",
               duration_ms=10, success=True),
        _event(2, bv_b, type="scene_completed", scene_id="s1",
               duration_ms=10, success=False),
    ])
    out = compute_progress(tmp_path, "course-x", bundle_version=bv_a)
    assert out["scenes"]["s1"]["completion_rate"] == 1.0
    assert out["scenes"]["s1"]["n_learners"] == 2

    out_all = compute_progress(tmp_path, "course-x")
    # 2 succès sur 3 events
    assert abs(out_all["scenes"]["s1"]["completion_rate"] - (2 / 3)) < 1e-9
    assert out_all["scenes"]["s1"]["n_learners"] == 3


def test_no_filter_returns_all_autonomy(tmp_path):
    bv_a = "1.1:b1@t1"
    bv_b = "1.1:b1@t2"
    _seed(tmp_path, "course-x", [
        _event(0, bv_a, type="critique_submitted", scene_id="s1",
               llm_score=0.5, completion_rate=1.0),
        _event(1, bv_b, type="adaptation_applied", rule_id="r1",
               signal="hint", modulator="M3", value=1.0),
    ])
    out_all = compute_autonomy(tmp_path, "course-x")
    assert out_all["n_critique"] == 1
    assert out_all["n_hints"] == 1

    out_a = compute_autonomy(tmp_path, "course-x", bundle_version=bv_a)
    assert out_a["n_critique"] == 1
    assert out_a["n_hints"] == 0


def test_filter_by_bundle_version_reasoning(tmp_path):
    bv_a = "1.1:b1@t1"
    bv_b = "1.1:b1@t2"
    _seed(tmp_path, "course-x", [
        _event(0, bv_a, type="reasoning_signal", scene_id="s1",
               signal="justification", confidence=0.8, turn_index=0),
        _event(1, bv_b, type="reasoning_signal", scene_id="s1",
               signal="hypothesis", confidence=0.8, turn_index=0),
    ])
    out_a = compute_reasoning_depth_score(
        tmp_path, "course-x", bundle_version=bv_a,
    )
    # Seul "justification" présent → score = 0.25
    assert out_a["scenes"]["s1"]["score"] == 0.25
    assert out_a["scenes"]["s1"]["n_signals"] == 1
