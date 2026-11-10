"""The usage report over streams the lesson server itself wrote (audit 2026-11-10, D1).

`fixtures/interaction-report/server-streams/` holds the consented streams of five labelled synthetic
learners who played a short lesson through the real host
(packages/lesson-session-host/src/host.interaction-report-seam.test.ts writes them, and fails when the
host's output drifts from them). Each stream opens with the `consent_granted` event the host now
writes; before that, every stream the server wrote was refused and the report was always SUPPRESSED.

Run: .venv/bin/python -m pytest tools/test_interaction_report_server_streams.py -q
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from interaction_report import build_interaction_report  # noqa: E402

SERVER_STREAMS = HERE / "fixtures" / "interaction-report" / "server-streams"


def _class_of(tmp_path: Path, n: int) -> Path:
    learners = sorted(p for p in SERVER_STREAMS.iterdir() if p.is_dir())
    assert len(learners) == 5, learners
    run = tmp_path / "data"
    for learner in learners[:n]:
        shutil.copytree(learner, run / learner.name)
    return run


def test_server_streams_open_with_the_operators_consent():
    for stream in SERVER_STREAMS.rglob("telemetry.jsonl"):
        events = [json.loads(line) for line in stream.read_text(encoding="utf-8").splitlines() if line.strip()]
        assert events[0]["type"] == "consent_granted" and events[0]["scope"] == "B", stream
        assert sum(e["type"] == "consent_granted" for e in events) == 1, stream


def test_five_server_written_streams_give_a_report(tmp_path):
    rep = build_interaction_report(_class_of(tmp_path, 5))
    assert rep["status"] == "ok", rep.get("reason")
    assert rep["refused_streams"] == 0
    assert rep["invalid_events"] == 0 and rep["malformed_lines"] == 0
    assert rep["fast_lane"]["measured"] is True
    assert rep["help_use"]["by_rung"]["hint"] == 5


def test_four_server_written_streams_are_suppressed(tmp_path):
    rep = build_interaction_report(_class_of(tmp_path, 4))
    assert rep["status"] == "suppressed"
    assert rep["refused_streams"] == 0          # consented, but under the floor
    assert rep["has_data"] is True


def test_a_server_stream_without_its_consent_line_is_refused(tmp_path):
    """A stream written before the host opened streams with `consent_granted` stays refused."""
    run = _class_of(tmp_path, 5)
    for stream in run.rglob("telemetry.jsonl"):
        lines = stream.read_text(encoding="utf-8").splitlines()
        stream.write_text("\n".join(l for l in lines if '"consent_granted"' not in l) + "\n", encoding="utf-8")
    rep = build_interaction_report(run)
    assert rep["status"] == "suppressed"
    assert rep["refused_streams"] == 5


def test_the_report_names_its_folder_without_its_path(tmp_path):
    """F11: `reason` carried the absolute data path (the user name with it). It now names the folder
    as the MCP class report does: its bare name and the first 8 hex of the sha256 of its real path."""
    import hashlib

    empty = tmp_path / "private-home" / "data"
    empty.mkdir(parents=True)
    rep = build_interaction_report(empty)
    assert rep["status"] == "suppressed"
    real = str(empty.resolve())
    assert real not in rep["reason"] and str(tmp_path) not in rep["reason"]
    assert "private-home" not in json.dumps(rep)
    assert "data" in rep["reason"]
    assert hashlib.sha256(real.encode("utf-8")).hexdigest()[:8] in rep["reason"]


def test_class_report_counts_the_resumed_learner_once(tmp_path):
    """One of the five server-written learners resumed (two `lesson_started`) and finished:
    completion is five learners of five, not five completions over six starts."""
    from class_report import build_report

    starts = sorted(sum(json.loads(l)["type"] == "lesson_started"
                        for l in s.read_text(encoding="utf-8").splitlines() if l.strip())
                    for s in SERVER_STREAMS.rglob("telemetry.jsonl"))
    assert starts == [1, 1, 1, 1, 2]
    rep = build_report(_class_of(tmp_path, 5))
    assert rep["completion_rate"] == 1.0
