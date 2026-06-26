import json
from pathlib import Path

from metrics import (
    compute_progress, compute_calibration, compute_autonomy,
    compute_progress_metrics,
)


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / "2026-05-09.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent  # data_dir


def _base(idx=0):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:learner{idx % 3}",
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
    }


def test_compute_progress(tmp_path):
    events = [
        {**_base(0), "type": "scene_completed", "scene_id": "s1", "duration_ms": 1000, "success": True},
        {**_base(1), "type": "scene_completed", "scene_id": "s1", "duration_ms": 1100, "success": False},
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    progress = compute_progress(data_dir, "c1")
    assert progress["scenes"]["s1"]["completion_rate"] == 0.5
    assert progress["scenes"]["s1"]["n_learners"] == 2


def test_compute_progress_empty_course(tmp_path):
    progress = compute_progress(tmp_path, "nonexistent")
    assert progress == {"scenes": {}}


def test_compute_calibration_brier(tmp_path):
    events = []
    for i, correct in enumerate([True, True, True, False]):
        events.append({
            **_base(i),
            "learner_pseudonym": "hmac:learner-a",  # all same learner
            "type": "quiz_answered",
            "scene_id": "q",
            "item_id": f"i{i}",
            "correct": correct,
            "confidence": 0.8,
            "response_time_ms": 1000,
        })
    data_dir = _write_events(tmp_path, "c1", events)
    cal = compute_calibration(data_dir, "c1", learner="hmac:learner-a")
    # Brier = ((0.8-1)^2 * 3 + (0.8-0)^2) / 4 = (0.04*3 + 0.64) / 4 = 0.19
    assert abs(cal["brier_score"] - 0.19) < 0.01
    assert cal["n_items"] == 4


def test_compute_calibration_no_data(tmp_path):
    cal = compute_calibration(tmp_path, "c-empty")
    assert cal == {"brier_score": None, "n_items": 0}


def test_compute_autonomy(tmp_path):
    events = [
        {**_base(0), "type": "critique_submitted", "scene_id": "s1", "llm_score": 0.7, "completion_rate": 0.8},
        {**_base(1), "type": "critique_submitted", "scene_id": "s2", "llm_score": 0.6, "completion_rate": 0.9},
        {**_base(2), "type": "adaptation_applied", "rule_id": "r1", "signal": "hint", "modulator": "M3", "value": 1.0},
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    a = compute_autonomy(data_dir, "c1")
    assert abs(a["critique_completion_rate"] - 0.85) < 0.01
    # autonomy_ratio = critique / (critique + hint) = 2/(2+1) ≈ 0.667
    assert abs(a["autonomy_ratio"] - 0.667) < 0.01
    assert a["n_critique"] == 2
    assert a["n_hints"] == 1


def test_compute_autonomy_scopes_to_ai_critique(tmp_path):
    """RC-2 (ADR 006 v1.4): the anti-offloading aggregates count ai_critique and
    its auditor variant spot_the_flaw, treat untagged legacy events as ai_critique,
    but EXCLUDE explain_back (teach-back is not an AI-critique signal)."""
    events = [
        # legacy untagged → counts as ai_critique (back-compat)
        {**_base(0), "type": "critique_submitted", "scene_id": "s0", "llm_score": 0.7, "completion_rate": 1.0},
        {**_base(1), "type": "critique_submitted", "scene_id": "s1", "scene_type": "ai_critique", "llm_score": 0.7, "completion_rate": 1.0},
        {**_base(2), "type": "critique_submitted", "scene_id": "s2", "scene_type": "spot_the_flaw", "llm_score": 0.6, "completion_rate": 1.0},
        # explain_back must NOT count
        {**_base(0), "type": "critique_submitted", "scene_id": "s3", "scene_type": "explain_back", "llm_score": 0.6, "completion_rate": 0.0},
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    a = compute_autonomy(data_dir, "c1")
    # 3 counted (untagged + ai_critique + spot_the_flaw); explain_back dropped.
    assert a["n_critique"] == 3
    assert a["n_hints"] == 0
    assert a["autonomy_ratio"] == 1.0
    # completion_rate mean over the 3 counted events (all 1.0); the 0.0 from
    # explain_back is excluded, so the mean is exactly 1.0 (not diluted).
    assert abs(a["critique_completion_rate"] - 1.0) < 1e-9


def test_compute_autonomy_zero_division_guard(tmp_path):
    a = compute_autonomy(tmp_path, "c-empty")
    assert a["critique_completion_rate"] == 0
    assert a["autonomy_ratio"] == 0
    assert a["n_critique"] == 0
    assert a["n_hints"] == 0


def test_compute_progress_iterates_multiple_jsonl_files(tmp_path):
    # Two days, two files
    events_day1 = [
        {**_base(0), "type": "scene_completed", "scene_id": "s1", "duration_ms": 1000, "success": True},
    ]
    events_day2 = [
        {**_base(1), "type": "scene_completed", "scene_id": "s1", "duration_ms": 1100, "success": True},
    ]
    course_dir = tmp_path / "c1"
    course_dir.mkdir()
    (course_dir / "2026-05-09.jsonl").write_text(json.dumps(events_day1[0]) + "\n")
    (course_dir / "2026-05-10.jsonl").write_text(json.dumps(events_day2[0]) + "\n")

    progress = compute_progress(tmp_path, "c1")
    assert progress["scenes"]["s1"]["completion_rate"] == 1.0
    assert progress["scenes"]["s1"]["n_learners"] == 2  # different learners (idx 0 and 1, mod 3)


def test_compute_progress_metrics_counts_scenes_with_evidence():
    """compute_progress_metrics retourne scenes_with_evidence basé sur le bundle."""
    # Bundle fake avec 3 scènes, dont 2 avec evidence
    bundle = {
        "schema_version": "1.4",
        "scenes": [
            {"id": "s1", "type": "intro", "evidence": {"enrichment_metadata": {}}},
            {"id": "s2", "type": "concept", "evidence": {"enrichment_metadata": {}}},
            {"id": "s3", "type": "quiz"},
        ],
    }
    # Appel simple sans events pour tester la logique du bundle
    metrics = compute_progress_metrics(
        bundle=bundle,
    )
    assert metrics["scenes_with_evidence"] == 2
    assert metrics["scenes_total"] == 3
