"""Tests for concept_mastery_history snapshots (M5.1).

Latest-wins par jour pour chaque (pseudonyme, concept_id). Stockage JSONL
append-only par cours/jour ; agrégation à la lecture.
"""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from store import (
    process_event_for_mastery,
    read_concept_mastery_history,
    record_concept_mastery_snapshot,
)


def _read_lines(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def test_snapshot_latest_wins_per_day(tmp_path):
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=2.0, beta=1.0, n_attempts=3,
    )
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=5.0, beta=2.0, n_attempts=7,
    )
    history = read_concept_mastery_history(tmp_path, "c1")
    assert "concept-A" in history
    rows = history["concept-A"]
    assert len(rows) == 1
    assert rows[0]["alpha"] == 5.0
    assert rows[0]["beta"] == 2.0
    assert rows[0]["n_attempts"] == 7
    assert abs(rows[0]["mastery"] - 5.0 / 7.0) < 1e-9


def test_snapshot_distinct_pseudonymes_same_day(tmp_path):
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=2.0, beta=1.0, n_attempts=3,
    )
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:bob", "concept-A",
        alpha=3.0, beta=4.0, n_attempts=7,
    )
    history = read_concept_mastery_history(tmp_path, "c1")
    rows = history["concept-A"]
    assert len(rows) == 2
    pseudos = {r["pseudonyme"] for r in rows}
    assert pseudos == {"hmac:alice", "hmac:bob"}


def test_read_history_30_days_ordered(tmp_path):
    start = date(2026, 4, 1)
    # Write in random order to verify sort
    days = [start + timedelta(days=i) for i in range(30)]
    for i, d in enumerate(reversed(days)):  # reversed insertion order
        record_concept_mastery_snapshot(
            tmp_path, "c1", d, "hmac:alice", "concept-A",
            alpha=float(i + 1), beta=1.0, n_attempts=i + 1,
        )
    history = read_concept_mastery_history(tmp_path, "c1", pseudonyme="hmac:alice")
    rows = history["concept-A"]
    assert len(rows) == 30
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates)


def test_read_history_unknown_pseudonyme_empty(tmp_path):
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=2.0, beta=1.0, n_attempts=3,
    )
    history = read_concept_mastery_history(tmp_path, "c1", pseudonyme="hmac:unknown")
    assert history == {}


def test_read_history_filter_concept_id(tmp_path):
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=2.0, beta=1.0, n_attempts=3,
    )
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-B",
        alpha=4.0, beta=3.0, n_attempts=7,
    )
    history = read_concept_mastery_history(tmp_path, "c1", concept_id="concept-B")
    assert set(history.keys()) == {"concept-B"}
    assert history["concept-B"][0]["alpha"] == 4.0


def test_degenerate_alpha_beta_one(tmp_path):
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=1.0, beta=1.0, n_attempts=0,
    )
    history = read_concept_mastery_history(tmp_path, "c1")
    assert history["concept-A"][0]["mastery"] == 0.5


def test_process_event_skips_non_relevant(tmp_path):
    event = {
        "type": "scene_entered",
        "scene_id": "s1",
        "learner_pseudonym": "hmac:alice",
        "client_timestamp": "2026-05-12T10:00:00Z",
        "concept_states": {  # even if present, scene_entered is not a trigger
            "concept-A": {"alpha": 5.0, "beta": 2.0, "n_attempts": 7},
        },
    }
    process_event_for_mastery(tmp_path, "c1", event)
    history = read_concept_mastery_history(tmp_path, "c1")
    assert history == {}


def test_process_event_lesson_completed_writes(tmp_path):
    event = {
        "type": "lesson_completed",
        "learner_pseudonym": "hmac:alice",
        "client_timestamp": "2026-05-12T10:00:00Z",
        "concept_states": {
            "concept-A": {"alpha": 5.0, "beta": 2.0, "n_attempts": 7},
            "concept-B": {"alpha": 1.0, "beta": 3.0, "n_attempts": 4},
        },
    }
    process_event_for_mastery(tmp_path, "c1", event)
    history = read_concept_mastery_history(tmp_path, "c1")
    assert set(history.keys()) == {"concept-A", "concept-B"}
    a = history["concept-A"][0]
    assert a["alpha"] == 5.0
    assert a["beta"] == 2.0
    assert a["n_attempts"] == 7
    assert abs(a["mastery"] - 5.0 / 7.0) < 1e-9


def test_process_event_scene_completed_with_concept_states_writes(tmp_path):
    event = {
        "type": "scene_completed",
        "scene_id": "s1",
        "learner_pseudonym": "hmac:alice",
        "client_timestamp": "2026-05-12T10:00:00Z",
        "concept_states": {
            "concept-A": {"alpha": 2.0, "beta": 1.0, "n_attempts": 3},
        },
    }
    process_event_for_mastery(tmp_path, "c1", event)
    history = read_concept_mastery_history(tmp_path, "c1")
    assert history["concept-A"][0]["alpha"] == 2.0


def test_process_event_missing_concept_states_no_write(tmp_path):
    """lesson_completed sans concept_states -> ne plante pas, n'écrit rien."""
    event = {
        "type": "lesson_completed",
        "learner_pseudonym": "hmac:alice",
        "client_timestamp": "2026-05-12T10:00:00Z",
    }
    process_event_for_mastery(tmp_path, "c1", event)
    history = read_concept_mastery_history(tmp_path, "c1")
    assert history == {}


def test_jsonl_file_path_layout(tmp_path):
    """Vérifie le layout {course}/{date}/concept_mastery.jsonl."""
    day = date(2026, 5, 12)
    record_concept_mastery_snapshot(
        tmp_path, "c1", day, "hmac:alice", "concept-A",
        alpha=2.0, beta=1.0, n_attempts=3,
    )
    expected = tmp_path / "c1" / "2026-05-12" / "concept_mastery.jsonl"
    assert expected.exists()
    lines = _read_lines(expected)
    assert len(lines) == 1
    assert lines[0]["pseudonyme"] == "hmac:alice"


def test_read_history_since_filter(tmp_path):
    record_concept_mastery_snapshot(
        tmp_path, "c1", date(2026, 4, 1), "hmac:alice", "concept-A",
        alpha=1.0, beta=1.0, n_attempts=0,
    )
    record_concept_mastery_snapshot(
        tmp_path, "c1", date(2026, 5, 1), "hmac:alice", "concept-A",
        alpha=3.0, beta=1.0, n_attempts=2,
    )
    history = read_concept_mastery_history(tmp_path, "c1", since=date(2026, 4, 15))
    rows = history["concept-A"]
    assert len(rows) == 1
    assert rows[0]["date"] == "2026-05-01"
