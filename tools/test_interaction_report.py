"""Tests for tools/interaction_report.py — the usage report over the interaction events of
INT-STUDIUM-058 (spec § 2.10, task 7.2). Same style as test_class_report.py: per-learner streams
written by hand under `sessions/<learner>/telemetry.jsonl`, small and deterministic.

Run: .venv/bin/python -m pytest tools/test_interaction_report.py -q
"""
import json
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "packages" / "telemetry-events" / "python"))
from pydantic import TypeAdapter  # noqa: E402
from telemetry_events import TelemetryEvent  # noqa: E402

import interaction_report  # noqa: E402
from interaction_report import (  # noqa: E402
    build_interaction_report,
    build_single_stream_report,
    main,
)

ADAPTER = TypeAdapter(TelemetryEvent)
REFUSAL = "refused: no consent_granted event in this stream"


def _base(learner: str, n: int) -> dict:
    return {
        "event_id": f"{learner}-{n:03d}",
        "learner_pseudonym": f"hmac:{learner}",
        "lesson_id": "demo",
        "bundle_version": "1.4:demo@2026-11-06T00:00:00Z",
        "client_timestamp": f"2026-11-06T10:{n // 60:02d}:{n % 60:02d}Z",
    }


def _stamp(learner: str, bodies: list[dict]) -> list[dict]:
    return [{**_base(learner, n), **body} for n, body in enumerate(bodies)]


def _learner_bodies(i: int, *, consent: bool = True) -> list[dict]:
    """Learner i (1..5): every learner contributes to every indicator, so no indicator of the
    five-learner class falls under the floor."""
    bodies = [{"type": "consent_granted", "scope": "A"}] if consent else []
    bodies += [
        {"type": "lesson_started", "bundle_uri": "bundles/demo/lesson.json"},
        # answer on q1 before any explain -> "before"
        {"type": "interaction", "act": "respond", "lane": "fast", "surface_rank": 3,
         "server_ms": 3, "client_ms": 100 * i, "scene_id": "q1"},
        {"type": "help_used", "rung": "explain", "scene_id": "q1"},
        # answer on q1 after the explain on q1 -> "after"
        {"type": "interaction", "act": "respond", "lane": "fast", "surface_rank": 3,
         "server_ms": 3, "client_ms": 200, "scene_id": "q1"},
        {"type": "interaction", "act": "ask", "lane": "companion", "surface_rank": 3, "server_ms": 2},
        # surface rank 1: outside the fast-lane share
        {"type": "interaction", "act": "hint", "lane": "fast", "surface_rank": 1,
         "server_ms": 1, "scene_id": "q2"},
        {"type": "help_used", "rung": "hint", "scene_id": "q2"},
        # answer on q2, no explain on q2 -> "before"
        {"type": "interaction", "act": "respond", "lane": "fast", "surface_rank": 2,
         "server_ms": 4, "client_ms": 1500 if i == 5 else 300, "scene_id": "q2"},
        {"type": "prompt_shown", "kind": "review_due", "attention": "normal", "surface_rank": 2},
        {"type": "prompt_outcome", "kind": "review_due",
         "outcome": "accepted" if i == 1 else "dismissed"},
        {"type": "contest", "concept_id": "c-un", "claim": "known",
         "outcome": "confirmed" if i <= 3 else "refuted", "questions": 2},
        {"type": "resume", "cause": "restart"},
        # q2 was already seen in this stream: a scene shown twice after a resume
        {"type": "interaction", "act": "turn", "lane": "fast", "surface_rank": 3,
         "server_ms": 2, "scene_id": "q2"},
        {"type": "review_receipt", "decision": "approved", "items": 4,
         "opened": 4 if i <= 2 else 2, "not_opened": 0 if i <= 2 else 2},
    ]
    return bodies


def _write_stream(run_dir: Path, learner: str, events: list[dict], extra_lines: tuple = ()) -> Path:
    d = run_dir / "sessions" / learner
    d.mkdir(parents=True, exist_ok=True)
    p = d / "telemetry.jsonl"
    lines = [json.dumps(e) for e in events] + list(extra_lines)
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return p


def _class(run_dir: Path, n: int = 5) -> list[list[dict]]:
    streams = []
    for i in range(1, n + 1):
        events = _stamp(f"p-{i}", _learner_bodies(i))
        _write_stream(run_dir, f"p-{i}", events)
        streams.append(events)
    return streams


# (7) the fixtures cannot drift from the schema --------------------------------------------------

def test_every_fixture_event_validates_against_the_python_contract():
    events = [e for i in range(1, 6) for e in _stamp(f"p-{i}", _learner_bodies(i))]
    events += _stamp("solo", _learner_bodies(1, consent=False))
    events += _stamp("p-1", _outcomes_bodies("review_due", 6, 1))
    events += _stamp("p-1", [{"type": "help_used", "rung": "reference", "scene_id": "q9"}])
    for e in events:
        assert ADAPTER.validate_python(e).type == e["type"]


# (1) five consented streams: each indicator ------------------------------------------------------

def test_five_consented_streams_give_every_indicator(tmp_path):
    _class(tmp_path)
    rep = build_interaction_report(tmp_path)

    assert rep["status"] == "ok"
    assert rep["scope"] == "class"
    assert rep["refused_streams"] == 0
    assert rep["malformed_lines"] == 0

    fl = rep["fast_lane"]
    assert (fl["acts"], fl["fast"], fl["share"]) == (25, 20, 0.8)
    assert fl["target"] == 0.8 and fl["meets_target"] is True

    vd = rep["verdict_delay"]
    assert vd["n"] == 15 and vd["p95_ms"] == 1500
    assert vd["target_ms"] == 1000 and vd["meets_target"] is False

    po = {row["kind"]: row for row in rep["prompt_outcomes"]["kinds"]}
    assert po["review_due"]["accepted"] == 1
    assert po["review_due"]["dismissed"] == 4
    assert po["review_due"]["ignored"] == 0
    assert po["review_due"]["total"] == 5
    assert po["review_due"]["acceptance"] == 0.2
    assert po["review_due"]["flagged"] is False
    assert rep["prompt_outcomes"]["flagged_kinds"] == []

    hu = rep["help_use"]
    assert hu["by_rung"] == {"reread": 0, "hint": 5, "explain": 5, "reference": 0}
    scenes = {row["scene_id"]: row for row in hu["scenes"]}
    assert scenes["q1"]["explain"] == 5 and scenes["q1"]["hint"] == 0
    assert scenes["q2"]["hint"] == 5 and scenes["q2"]["explain"] == 0
    assert hu["answers_before_explain"] == 10
    assert hu["answers_after_explain"] == 5

    ct = rep["contests"]
    assert ct["count"] == 5
    assert ct["by_outcome"] == {"confirmed": 3, "refuted": 2, "partial": 0}

    rs = rep["resumes"]
    assert rs["count"] == 5
    assert rs["by_cause"] == {"restart": 5, "surface_change": 0, "paused": 0}
    assert rs["scenes_shown_twice"] == 5

    rv = rep["review"]
    assert rv["receipts"] == 5
    assert rv["fully_opened_share"] == 0.4
    assert rv["mean_opened_share"] == 0.7
    assert rv["decisions"] == {"approved": 5, "returned": 0}

    # aggregate only: no pseudonym, no stream path, no exact cohort size
    dumped = json.dumps(rep)
    assert "hmac:" not in dumped and "sessions" not in dumped
    assert "n_learners" not in rep


def test_markdown_renders_each_section(tmp_path):
    _class(tmp_path)
    md = interaction_report._md(build_interaction_report(tmp_path))
    for heading in ("Fast lane", "Verdict delay", "Prompt outcomes", "Help use", "Contests",
                    "Resumes", "Review"):
        assert heading in md
    assert "hmac:" not in md


# (2) four streams: the whole report is suppressed -----------------------------------------------

def test_four_streams_suppress_the_whole_report_without_stating_its_size(tmp_path):
    _class(tmp_path, n=4)
    rep = build_interaction_report(tmp_path)
    assert rep["suppressed"] is True
    assert rep["status"] == "suppressed"
    assert "4" not in rep["reason"], rep["reason"]
    assert "5" in rep["reason"]
    for key in ("fast_lane", "verdict_delay", "prompt_outcomes", "help_use", "contests",
                "resumes", "review", "n_learners", "n_streams", "cohort_band"):
        assert key not in rep


# (3) consent ------------------------------------------------------------------------------------

def test_a_stream_without_consent_is_refused_counted_and_the_rest_aggregates(tmp_path):
    _class(tmp_path)
    # the refused stream would move the fast-lane share if it were read
    noisy = _learner_bodies(6, consent=False) + [
        {"type": "interaction", "act": "ask", "lane": "companion", "surface_rank": 3, "server_ms": 2}
    ] * 10
    _write_stream(tmp_path, "no-consent", _stamp("p-6", noisy))
    rep = build_interaction_report(tmp_path)
    assert rep["status"] == "ok"
    assert rep["refused_streams"] == 1
    assert rep["fast_lane"]["share"] == 0.8 and rep["fast_lane"]["acts"] == 25
    assert rep["contests"]["count"] == 5


# (4) single stream ------------------------------------------------------------------------------

def test_single_stream_reports_one_consented_file_with_its_warning(tmp_path, capsys):
    p = _write_stream(tmp_path, "bench-1", _stamp("bench-1", _learner_bodies(1)))
    rep = build_single_stream_report(p)
    assert rep["status"] == "ok"
    assert rep["scope"] == "single_stream"
    assert "one learner" in rep["warning"] and "person" in rep["warning"]
    assert rep["fast_lane"]["share"] == 0.8
    assert rep["contests"]["count"] == 1

    assert main([str(p), "--single-stream", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["scope"] == "single_stream"


def test_single_stream_without_consent_exits_non_zero_with_the_message(tmp_path, capsys):
    p = _write_stream(tmp_path, "bench-2", _stamp("bench-2", _learner_bodies(1, consent=False)))
    code = main([str(p), "--single-stream"])
    assert code != 0
    captured = capsys.readouterr()
    assert REFUSAL in captured.err
    assert "hmac:" not in captured.err + captured.out


# (5) the acceptance flag ------------------------------------------------------------------------

def _outcomes_bodies(kind: str, n: int, accepted: int) -> list[dict]:
    return [{"type": "prompt_outcome", "kind": kind,
             "outcome": "accepted" if j < accepted else "ignored"} for j in range(n)]


def test_a_kind_under_twenty_percent_over_thirty_outcomes_is_flagged(tmp_path):
    # review_due: 6 outcomes per learner, 1 accepted -> 30 outcomes, 5 accepted (16.7 %)
    # break: 6,6,6,6,5 outcomes, none accepted -> 29 outcomes, not enough to flag
    for i in range(1, 6):
        bodies = [{"type": "consent_granted", "scope": "A"}]
        bodies += _outcomes_bodies("review_due", 6, 1)
        bodies += _outcomes_bodies("break", 6 if i < 5 else 5, 0)
        _write_stream(tmp_path, f"p-{i}", _stamp(f"p-{i}", bodies))
    rep = build_interaction_report(tmp_path)
    kinds = {row["kind"]: row for row in rep["prompt_outcomes"]["kinds"]}
    assert kinds["review_due"]["total"] == 30
    assert kinds["review_due"]["flagged"] is True
    assert kinds["break"]["total"] == 29
    assert kinds["break"]["flagged"] is False
    assert rep["prompt_outcomes"]["flagged_kinds"] == ["review_due"]


# (6) the floor can only be raised ---------------------------------------------------------------

def test_min_learners_below_the_floor_is_clamped_up(tmp_path, capsys):
    _class(tmp_path, n=4)
    rep = build_interaction_report(tmp_path, min_learners=2)
    assert rep["suppressed"] is True and rep["min_learners"] == 5

    assert main([str(tmp_path), "--min-learners", "2", "--json"]) == 0
    captured = capsys.readouterr()
    out = json.loads(captured.out)
    assert out["suppressed"] is True and out["min_learners"] == 5
    assert "raised to the floor" in captured.err


def test_min_learners_above_the_floor_is_kept(tmp_path):
    _class(tmp_path)
    rep = build_interaction_report(tmp_path, min_learners=6)
    assert rep["suppressed"] is True and rep["min_learners"] == 6


# rows under the floor, malformed lines, unknown types -------------------------------------------

def test_a_scene_row_under_the_floor_is_withheld_without_a_count(tmp_path):
    _class(tmp_path)
    p = tmp_path / "sessions" / "p-1" / "telemetry.jsonl"
    extra = _stamp("p-1", [{"type": "help_used", "rung": "reference", "scene_id": "q9"}])
    p.write_text(p.read_text(encoding="utf-8") + json.dumps({**extra[0], "event_id": "p-1-900"}) + "\n",
                 encoding="utf-8")
    rep = build_interaction_report(tmp_path)
    scenes = {row["scene_id"] for row in rep["help_use"]["scenes"]}
    assert "q9" not in scenes
    assert rep["help_use"]["withheld_below_floor"] is True
    assert "q9" not in json.dumps(rep)


def test_malformed_lines_are_counted_never_echoed_and_unknown_types_ignored(tmp_path):
    _class(tmp_path)
    secret = "this-line-is-broken {"
    unknown = json.dumps({**_base("p-2", 999), "type": "something_new", "x": 1})
    _write_stream(tmp_path, "p-2", _stamp("p-2", _learner_bodies(2)), extra_lines=(secret, unknown))
    rep = build_interaction_report(tmp_path)
    assert rep["status"] == "ok"
    assert rep["malformed_lines"] == 1
    assert secret not in json.dumps(rep)
    assert rep["fast_lane"]["acts"] == 25


def test_out_writes_json_and_markdown(tmp_path):
    run = tmp_path / "run"
    _class(run)
    out = tmp_path / "out"
    assert main([str(run), "--out", str(out)]) == 0
    assert json.loads((out / "interaction_report.json").read_text(encoding="utf-8"))["status"] == "ok"
    assert (out / "interaction_report.md").read_text(encoding="utf-8").startswith("#")


# (8) review streams: the CLI's review_receipt events next to the receipts ----------------------

def _review_event(sha: str, decided_at: str, body: dict | None = None) -> dict:
    event = {
        "event_id": f"review-{sha[:6]}",
        "learner_pseudonym": "reviewer",
        "lesson_id": "demo",
        "bundle_version": "1.4:demo@2026-11-06T00:00:00Z",
        "client_timestamp": decided_at,
        "type": "review_receipt",
        "decision": "approved",
        "items": 4,
        "opened": 2,
        "not_opened": 2,
    }
    event.update(body or {})
    return event


def _write_review_stream(run_dir: Path, events: list[dict], *, name: str = "reviews") -> Path:
    d = run_dir / name
    d.mkdir(parents=True, exist_ok=True)
    p = d / "telemetry.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
    return p


def test_a_review_stream_feeds_the_review_block_without_joining_the_floor(tmp_path):
    _class(tmp_path)
    without = build_interaction_report(tmp_path)

    _write_review_stream(
        tmp_path,
        [
            _review_event("a1", "2026-11-07T09:00:00Z"),
            _review_event("b2", "2026-11-07T09:05:00Z", {"decision": "returned", "opened": 4, "not_opened": 0}),
        ],
    )
    rep = build_interaction_report(tmp_path)

    assert rep["status"] == "ok"
    assert rep["refused_streams"] == 0
    assert rep["invalid_events"] == 0
    # the reviewer is a role, not a learner: the floor and the cohort do not move
    assert rep["cohort_band"] == without["cohort_band"]
    assert rep["cohort_counts"] == without["cohort_counts"]

    rv = rep["review"]
    assert rv["source"] == "reviews"
    assert rv["receipts"] == 7  # the five learner-stream receipts plus the two review-stream ones
    assert rv["fully_opened_share"] == round(3 / 7, 3)
    assert rv["decisions"] == {"approved": 6, "returned": 1}
    assert interaction_report._md(rep)


def test_a_review_stream_needs_no_consent_and_is_not_refused(tmp_path):
    _class(tmp_path)
    _write_review_stream(tmp_path, [_review_event("a1", "2026-11-07T09:00:00Z")])

    rep = build_interaction_report(tmp_path)

    assert rep["refused_streams"] == 0
    assert rep["review"]["receipts"] == 6


def test_a_reviews_path_with_a_foreign_pseudonym_is_read_as_a_learner_stream(tmp_path):
    """Decision: rule 5 classifies by content, so a `reviews/` path carrying any non-reviewer line
    is a learner stream and is refused without consent, not a review stream with one invalid line."""
    _class(tmp_path)
    _write_review_stream(
        tmp_path,
        [
            _review_event("a1", "2026-11-07T09:00:00Z"),
            _review_event("b2", "2026-11-07T09:05:00Z", {"learner_pseudonym": "hmac:someone"}),
        ],
    )

    rep = build_interaction_report(tmp_path)

    assert rep["invalid_events"] == 0
    assert rep["refused_streams"] == 1
    assert rep["review"]["receipts"] == 5  # the learner receipts only


def test_a_learner_stream_receipt_alone_keeps_the_review_block_withheld(tmp_path):
    _class(tmp_path)
    for i in range(2, 6):
        healthy = _stamp(f"p-{i}", [b for b in _learner_bodies(i) if b["type"] != "review_receipt"])
        _write_stream(tmp_path, f"p-{i}", healthy)

    rep = build_interaction_report(tmp_path)

    assert rep["status"] == "ok"
    assert rep["review"] == {"measured": True, "withheld": True}


def test_a_review_stream_publishes_without_the_learner_receipt_still_under_its_floor(tmp_path):
    _class(tmp_path)
    for i in range(2, 6):
        healthy = _stamp(f"p-{i}", [b for b in _learner_bodies(i) if b["type"] != "review_receipt"])
        _write_stream(tmp_path, f"p-{i}", healthy)
    _write_review_stream(tmp_path, [_review_event("a1", "2026-11-07T09:00:00Z")])

    rep = build_interaction_report(tmp_path)

    # The CLI's receipt is class-level: the class of five lets it through. The one learner-stream
    # receipt (p-1) keeps its own gate (one learner under a floor of five) and stays out of the
    # figures, which say so: one receipt, not two.
    assert rep["review"]["measured"] is True
    assert "withheld" not in rep["review"]
    assert rep["review"]["source"] == "reviews"
    assert rep["review"]["receipts"] == 1
    assert rep["review"]["decisions"] == {"approved": 1, "returned": 0}
    assert rep["review"]["learner_receipts_withheld"] is True


def test_learner_receipts_join_the_review_stream_once_their_own_floor_passes(tmp_path):
    _class(tmp_path)  # five learners, each carrying one approved receipt in its own stream
    _write_review_stream(tmp_path, [_review_event("a1", "2026-11-07T09:00:00Z")])

    rep = build_interaction_report(tmp_path)

    assert rep["review"]["receipts"] == 6  # five learner-stream receipts plus the CLI's
    assert rep["review"]["decisions"] == {"approved": 6, "returned": 0}
    assert "learner_receipts_withheld" not in rep["review"]


def test_a_reviewer_labelled_event_in_a_learner_stream_does_not_count_as_a_learner(tmp_path):
    for i in range(1, 5):
        _write_stream(tmp_path, f"p-{i}", _stamp(f"p-{i}", _learner_bodies(i)))
    ghost = _stamp("ghost", [{"type": "consent_granted", "scope": "A"},
                             *_learner_bodies(1)[1:]])
    for event in ghost:
        event["learner_pseudonym"] = "reviewer"
    _write_stream(tmp_path, "ghost", ghost)

    rep = build_interaction_report(tmp_path)

    # Four learners plus a "reviewer" label: a role, not a fifth learner, so the floor holds.
    assert rep["status"] == "suppressed"
    assert rep["min_learners"] == 5


def test_a_learner_stream_under_a_reviews_bundle_is_read_as_a_learner_stream(tmp_path):
    p = tmp_path / "p-1" / "reviews" / "telemetry.jsonl"
    p.parent.mkdir(parents=True)
    p.write_text("\n".join(json.dumps(e) for e in _stamp("p-1", _learner_bodies(1))) + "\n",
                 encoding="utf-8")

    rep = build_single_stream_report(p)

    assert rep["scope"] == "single_stream"
    assert rep["fast_lane"]["share"] == 0.8
    assert rep["review"]["receipts"] == 1
    assert "one learner" in rep["warning"]


def test_single_stream_on_a_review_stream_reports_the_review_block_alone(tmp_path, capsys):
    p = _write_review_stream(tmp_path, [_review_event("a1", "2026-11-07T09:00:00Z")])

    assert main([str(p), "--single-stream", "--json"]) == 0
    rep = json.loads(capsys.readouterr().out)
    assert rep["review"]["measured"] is True
    assert rep["review"]["receipts"] == 1 and rep["review"]["source"] == "reviews"
    assert rep["fast_lane"] == {"measured": False}
    assert rep["contests"] == {"measured": False}
    # a review stream is not "one learner's": its warning says what it is
    assert "one learner's" not in rep["warning"]
    assert "review" in rep["warning"]


if __name__ == "__main__":  # pragma: no cover
    sys.exit(pytest.main([os.path.abspath(__file__), "-q"]))
