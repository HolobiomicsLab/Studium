"""Tests for the decisive-trial pilot export."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pilot_export import build_study_table  # noqa: E402


def _ev(scene, pseudo, tp, missed, fp, planted):
    return {"type": "ai_audit_result", "scene_id": scene, "pseudonyme": pseudo,
            "true_positives": tp, "missed": missed, "false_positives": fp, "planted_errors": planted}


def test_only_transfer_scenes_count_toward_the_primary_endpoint():
    events = [
        _ev("transfer_1", "A", 2, 0, 0, 2),   # counts
        _ev("practice_1", "A", 0, 2, 0, 2),   # NOT a transfer scene -> excluded
    ]
    out = build_study_table(events, {"A": "treatment"}, {"transfer_1"})
    assert len(out["rows"]) == 1
    assert out["rows"][0]["judgment_transfer_score"] == 1.0  # 2/(2+0), practice excluded


def test_arm_is_attached_and_score_is_hits_over_signal_trials():
    events = [_ev("t", "A", 2, 0, 0, 2), _ev("t", "B", 0, 2, 1, 2)]
    out = build_study_table(events, {"A": "treatment", "B": "control"}, {"t"})
    by = {r["pseudonym"]: r for r in out["rows"]}
    assert by["A"]["arm"] == "treatment" and by["A"]["judgment_transfer_score"] == 1.0
    assert by["B"]["arm"] == "control" and by["B"]["judgment_transfer_score"] == 0.0
    assert by["B"]["false_alarms"] == 1


def test_learners_without_an_arm_or_transfer_trial_are_skipped_not_dropped():
    events = [_ev("t", "A", 1, 1, 0, 2), _ev("t", "Z", 1, 0, 0, 1)]
    out = build_study_table(events, {"A": "treatment"}, {"t"})  # Z has no arm
    assert [r["pseudonym"] for r in out["rows"]] == ["A"]
    assert out["skipped"] == ["Z"]


def test_pooling_across_multiple_transfer_scenes():
    events = [_ev("t1", "A", 1, 0, 0, 1), _ev("t2", "A", 1, 1, 0, 2)]
    out = build_study_table(events, {"A": "treatment"}, {"t1", "t2"})
    assert out["rows"][0]["hits"] == 2 and out["rows"][0]["misses"] == 1
    assert out["rows"][0]["judgment_transfer_score"] == round(2 / 3, 4)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok {name}")
