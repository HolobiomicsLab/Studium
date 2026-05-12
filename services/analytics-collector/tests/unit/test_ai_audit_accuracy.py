"""Unit tests for ai_audit_accuracy (M5.3).

Formule par scène :
    accuracy(scene) = max(0, (true_positives - false_positives) / planted_errors)
    - planted == 0 → accuracy = None (impossible à scorer)
    - false_positives > true_positives → clampé à 0
    - clamp strict [0, 1]

Overall = moyenne arithmétique des accuracies par scène (ignore les None).
"""

import json
from pathlib import Path

from metrics import compute_ai_audit_accuracy


def _base(idx=0, pseudo="hmac:learner0"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-12T10:00:00Z",
    }


def _audit_event(idx, scene_id, tp, fp, planted, missed,
                 pseudo="hmac:learner0"):
    return {
        **_base(idx, pseudo=pseudo),
        "type": "ai_audit_result",
        "scene_id": scene_id,
        "true_positives": tp,
        "false_positives": fp,
        "planted_errors": planted,
        "missed": missed,
    }


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / "2026-05-12.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def test_perfect_score(tmp_path):
    """TP=3, FP=0, planted=3 → 1.0"""
    events = [_audit_event(0, "s1", tp=3, fp=0, planted=3, missed=0)]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    assert result["overall_accuracy"] == 1.0
    assert result["n_scenes"] == 1
    s1 = result["per_scene"][0]
    assert s1["scene_id"] == "s1"
    assert s1["accuracy"] == 1.0
    assert s1["true_positives"] == 3
    assert s1["false_positives"] == 0
    assert s1["planted_errors"] == 3
    assert s1["missed"] == 0


def test_partial_score(tmp_path):
    """TP=2, FP=1, planted=3 → 0.333"""
    events = [_audit_event(0, "s1", tp=2, fp=1, planted=3, missed=1)]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    s1 = result["per_scene"][0]
    assert abs(s1["accuracy"] - (1 / 3)) < 1e-9
    assert abs(result["overall_accuracy"] - (1 / 3)) < 1e-9


def test_fp_exceeds_tp_clamped_to_zero(tmp_path):
    """TP=1, FP=2, planted=3 → 0.0 (clampé)"""
    events = [_audit_event(0, "s1", tp=1, fp=2, planted=3, missed=2)]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    s1 = result["per_scene"][0]
    assert s1["accuracy"] == 0.0
    assert result["overall_accuracy"] == 0.0


def test_planted_zero_returns_none(tmp_path):
    """planted=0 → accuracy=None (non scorable)"""
    events = [_audit_event(0, "s1", tp=0, fp=0, planted=0, missed=0)]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    s1 = result["per_scene"][0]
    assert s1["accuracy"] is None
    assert s1["planted_errors"] == 0
    # Aucune scène scorable → overall = None
    assert result["overall_accuracy"] is None
    assert result["n_scenes"] == 1


def test_overall_average_ignores_none(tmp_path):
    """3 scènes : 1.0, None, 0.5 → overall = 0.75 (moyenne sur 2 scorables)."""
    events = [
        _audit_event(0, "s1", tp=3, fp=0, planted=3, missed=0),  # 1.0
        _audit_event(1, "s2", tp=0, fp=0, planted=0, missed=0),  # None
        _audit_event(2, "s3", tp=2, fp=0, planted=4, missed=2),  # 0.5
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    assert result["n_scenes"] == 3
    assert abs(result["overall_accuracy"] - 0.75) < 1e-9


def test_filter_by_pseudonyme(tmp_path):
    """Filtre pseudonyme — seuls les events du pseudonyme comptent."""
    events = [
        _audit_event(0, "s1", tp=3, fp=0, planted=3, missed=0, pseudo="hmac:a"),
        _audit_event(1, "s1", tp=0, fp=3, planted=3, missed=3, pseudo="hmac:b"),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result_a = compute_ai_audit_accuracy(data_dir, "c1", pseudonyme="hmac:a")
    assert result_a["overall_accuracy"] == 1.0
    assert result_a["n_scenes"] == 1
    assert result_a["per_scene"][0]["true_positives"] == 3

    result_b = compute_ai_audit_accuracy(data_dir, "c1", pseudonyme="hmac:b")
    assert result_b["overall_accuracy"] == 0.0
    assert result_b["n_scenes"] == 1


def test_empty_course_no_audit_events_overall_null(tmp_path):
    """Aucun event ai_audit_result → overall_accuracy=None, n_scenes=0."""
    events = [
        {**_base(0), "type": "scene_entered", "scene_id": "s1",
         "scene_type": "ai_audit"},
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    assert result["overall_accuracy"] is None
    assert result["n_scenes"] == 0
    assert result["per_scene"] == []


def test_multiple_scenes_per_pseudonyme(tmp_path):
    """Plusieurs scènes pour un même pseudonyme — agrégat correct."""
    events = [
        _audit_event(0, "s_critique_1", tp=2, fp=1, planted=3, missed=1),
        _audit_event(1, "s_critique_2", tp=4, fp=0, planted=4, missed=0),
    ]
    data_dir = _write_events(tmp_path, "c1", events)
    result = compute_ai_audit_accuracy(data_dir, "c1")
    assert result["n_scenes"] == 2
    by_scene = {s["scene_id"]: s for s in result["per_scene"]}
    assert abs(by_scene["s_critique_1"]["accuracy"] - (1 / 3)) < 1e-9
    assert by_scene["s_critique_2"]["accuracy"] == 1.0
    # overall = mean(1/3, 1.0) = 2/3
    assert abs(result["overall_accuracy"] - ((1 / 3) + 1.0) / 2) < 1e-9
