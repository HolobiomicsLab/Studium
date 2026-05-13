"""Unit tests for compute_cooperation_metrics (F2.1, views v0.4).

Aggregates ``cooperative_vote`` + ``cooperative_convergence`` events posted
to the collector. The M4 LAN runtime that emits these events is deferred —
v1 operates on POST'ed fixtures only.

n_sessions = number of cooperative_convergence events (each convergence
event marks the close of one cooperative session).
"""

import json

from metrics import compute_cooperation_metrics


def _write_event(tmp_path, course, day, event):
    """Append one event to ``tmp_path/<course>/<day>.jsonl``.

    Mirrors the convention used by the other analytics-collector unit tests
    (day as filename, not subdirectory) — this is what ``_iter_events`` in
    metrics.py expects (``data_dir/<course>/*.jsonl`` glob, non-recursive).
    """
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"{day}.jsonl"
    with open(f, "a") as fh:
        fh.write(json.dumps(event) + "\n")


def test_no_events_returns_zero_sessions(tmp_path):
    result = compute_cooperation_metrics(tmp_path, "c1")
    assert result["n_sessions"] == 0
    assert result["convergence_quality"] is None
    assert result["role_coverage_mean"] is None
    assert result["disagreement_productive_ratio"] is None
    assert result["votes_per_session_mean"] == 0


def test_aggregates_votes_and_convergence(tmp_path):
    for e in [
        {
            "event_id": "v1", "type": "cooperative_vote",
            "question_id": "q1", "group_size": 4, "aggregate_only": True,
            "learner_pseudonym": "p", "lesson_id": "L",
            "client_timestamp": "2026-05-13T10:00:00Z",
        },
        {
            "event_id": "v2", "type": "cooperative_vote",
            "question_id": "q2", "group_size": 4, "aggregate_only": True,
            "learner_pseudonym": "p", "lesson_id": "L",
            "client_timestamp": "2026-05-13T10:01:00Z",
        },
        {
            "event_id": "c1", "type": "cooperative_convergence",
            "synthesis_id": "s1", "group_size": 4,
            "confidence_distribution_aggregated": [0, 0, 1, 2, 1],
            "role_coverage": 0.75,
            "learner_pseudonym": "p", "lesson_id": "L",
            "client_timestamp": "2026-05-13T10:02:00Z",
        },
    ]:
        _write_event(tmp_path, "c1", "2026-05-13", e)
    result = compute_cooperation_metrics(tmp_path, "c1")
    assert result["n_sessions"] == 1
    assert result["votes_per_session_mean"] == 2.0
    assert 0 <= result["convergence_quality"] <= 1
    assert result["role_coverage_mean"] == 0.75


def test_multiple_sessions(tmp_path):
    sessions = [
        ("s1", 0.6),
        ("s2", 0.8),
        ("s3", 0.5),
    ]
    for i, (sid, rc) in enumerate(sessions):
        _write_event(tmp_path, "c1", "2026-05-13", {
            "event_id": f"c{i}", "type": "cooperative_convergence",
            "synthesis_id": sid, "group_size": 3,
            "confidence_distribution_aggregated": [0, 0, 0, 2, 1],
            "role_coverage": rc,
            "learner_pseudonym": "p", "lesson_id": "L",
            "client_timestamp": f"2026-05-13T1{i}:00:00Z",
        })
    result = compute_cooperation_metrics(tmp_path, "c1")
    assert result["n_sessions"] == 3
    assert abs(result["role_coverage_mean"] - 0.6333) < 0.01
