"""Unit tests for compute_journal_metrics (F1.3, ADR 006 v1.3).

Counters only — no journal text ever transmitted nor stored server-side.
Server only receives metadata events ``journal_entry_submitted`` with
``entry_length`` (int), ``is_revision`` (bool), ``scene_id``,
``learner_pseudonym``. The journal text itself stays local (SQLCipher).
"""

import json
from pathlib import Path

from metrics import compute_journal_metrics


def _base(idx=0, pseudo="hmac:learner0"):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": pseudo,
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-13T10:00:00Z",
    }


def _journal_event(idx, scene_id, length, is_revision=False, pseudo="hmac:learner0"):
    return {
        **_base(idx, pseudo=pseudo),
        "type": "journal_entry_submitted",
        "scene_id": scene_id,
        "entry_length": length,
        "is_revision": is_revision,
    }


def _write_event(tmp_path: Path, course: str, events: list[dict]) -> Path:
    """Write events to ``tmp_path/course/<date>.jsonl`` and return data_dir (tmp_path)."""
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / "2026-05-13.jsonl"
    f.write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return tmp_path


def test_no_journal_events_returns_zero_totals(tmp_path):
    """Empty data → all counters zero, no scene breakdown."""
    data_dir = _write_event(tmp_path, "c1", [])
    result = compute_journal_metrics(data_dir, "c1")
    assert result["entries_total"] == 0
    assert result["mean_length"] == 0
    assert result["revision_rate"] == 0
    assert result["entries_by_scene"] == {}


def test_aggregates_entries_total_and_mean_length(tmp_path):
    """2 events of length 100 and 200 → total=2, mean_length=150.0."""
    events = [
        _journal_event(0, "s1", 100),
        _journal_event(1, "s1", 200),
    ]
    data_dir = _write_event(tmp_path, "c1", events)
    result = compute_journal_metrics(data_dir, "c1")
    assert result["entries_total"] == 2
    assert result["mean_length"] == 150.0
    assert result["entries_by_scene"]["s1"]["count"] == 2
    assert result["entries_by_scene"]["s1"]["mean_length"] == 150.0


def test_revision_rate(tmp_path):
    """3 events, 1 is_revision=True → revision_rate ≈ 1/3 = 0.3333."""
    events = [
        _journal_event(0, "s1", 100, is_revision=False),
        _journal_event(1, "s1", 100, is_revision=False),
        _journal_event(2, "s1", 100, is_revision=True),
    ]
    data_dir = _write_event(tmp_path, "c1", events)
    result = compute_journal_metrics(data_dir, "c1")
    assert result["entries_total"] == 3
    assert result["revision_rate"] == 0.3333


def test_filter_by_pseudonyme(tmp_path):
    """2 pseudos, filter=alice → only alice's entries returned."""
    events = [
        _journal_event(0, "s1", 100, pseudo="hmac:alice"),
        _journal_event(1, "s1", 200, pseudo="hmac:alice"),
        _journal_event(2, "s2", 300, pseudo="hmac:bob"),
    ]
    data_dir = _write_event(tmp_path, "c1", events)
    result = compute_journal_metrics(data_dir, "c1", pseudonyme="hmac:alice")
    assert result["entries_total"] == 2
    assert result["mean_length"] == 150.0
    assert "s1" in result["entries_by_scene"]
    assert "s2" not in result["entries_by_scene"]
