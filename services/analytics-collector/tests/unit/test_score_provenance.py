"""How much is `critique_completion_rate` worth? `keyword_graded_rate` is the answer.

The runtime falls back to a substring matcher whenever the critique service is absent or
errors, and until ADR 006 v1.6 that produced a `critique_submitted` event indistinguishable
from a semantically-graded one. The collector averaged the two together and the dashboard
showed one number. `score_source` now tags each event, and this aggregate reports the share
that came from the matcher — beside the completion rate it qualifies.

What the keyword path is WORTH pedagogically is INT-STUDIUM-035 and belongs to the product
owner. This is only the part that makes it countable.
"""
import json
from pathlib import Path

from metrics import compute_autonomy


def _write_events(tmp_path: Path, course: str, events: list[dict]) -> Path:
    d = tmp_path / course
    d.mkdir(parents=True, exist_ok=True)
    (d / "2026-05-09.jsonl").write_text("\n".join(json.dumps(e) for e in events) + "\n")
    return d.parent


def _base(idx=0):
    return {
        "event_id": f"01923456-7890-1234-5678-abcdef01234{idx}",
        "learner_pseudonym": f"hmac:learner{idx % 3}",
        "lesson_id": "l1",
        "bundle_version": "1.0.0",
        "client_timestamp": "2026-05-09T10:00:00Z",
    }


def _critique(idx, **kw):
    ev = {**_base(idx), "type": "critique_submitted", "scene_id": f"s{idx}",
          "llm_score": 0.7, "completion_rate": 1.0, "scene_type": "ai_critique"}
    ev.update(kw)
    return ev


def test_a_fully_keyword_graded_cohort_reads_1(tmp_path):
    data_dir = _write_events(tmp_path, "c1", [
        _critique(0, score_source="keyword"),
        _critique(1, score_source="keyword"),
    ])
    a = compute_autonomy(data_dir, "c1")
    assert a["keyword_graded_rate"] == 1.0
    assert a["n_score_source_known"] == 2
    # and the completion rate it qualifies is unchanged — this adds a caveat, not a correction
    assert a["critique_completion_rate"] == 1.0


def test_a_mixed_cohort_reads_the_share(tmp_path):
    data_dir = _write_events(tmp_path, "c1", [
        _critique(0, score_source="keyword"),
        _critique(1, score_source="llm"),
        _critique(2, score_source="llm"),
    ])
    a = compute_autonomy(data_dir, "c1")
    assert abs(a["keyword_graded_rate"] - 1 / 3) < 1e-9
    assert a["n_score_source_known"] == 3


def test_an_llm_graded_cohort_reads_0_and_that_zero_is_earned(tmp_path):
    data_dir = _write_events(tmp_path, "c1", [_critique(0, score_source="llm")])
    a = compute_autonomy(data_dir, "c1")
    assert a["keyword_graded_rate"] == 0.0
    assert a["n_score_source_known"] == 1


def test_untagged_events_are_unmeasured_not_zero(tmp_path):
    """The distinction the whole field exists for.

    Events predating v1.6 carry no `score_source`. Reporting 0.0 for them would tell a teacher
    "none of this was keyword-graded", which is the reassuring reading of a question nobody
    asked. None says the measurement is missing.
    """
    data_dir = _write_events(tmp_path, "c1", [_critique(0), _critique(1)])
    a = compute_autonomy(data_dir, "c1")
    assert a["keyword_graded_rate"] is None
    assert a["n_score_source_known"] == 0
    assert a["n_critique"] == 2, "the events still count toward autonomy — only the tag is absent"


def test_a_partially_tagged_cohort_reports_its_own_denominator(tmp_path):
    """A rate over the tagged subset, and the subset size beside it, so nobody reads it as a
    rate over the cohort."""
    data_dir = _write_events(tmp_path, "c1", [
        _critique(0),
        _critique(1, score_source="keyword"),
        _critique(2, score_source="llm"),
    ])
    a = compute_autonomy(data_dir, "c1")
    assert a["keyword_graded_rate"] == 0.5
    assert a["n_score_source_known"] == 2
    assert a["n_critique"] == 3


def test_the_verdict_deck_is_neither_keyword_nor_llm(tmp_path):
    """`spot_the_flaw`'s deck path grades marks, not text: it calls no evaluator and no matcher.
    Counting it as keyword-graded would overstate the problem."""
    data_dir = _write_events(tmp_path, "c1", [
        _critique(0, scene_type="spot_the_flaw", score_source="verdict_deck"),
        _critique(1, scene_type="spot_the_flaw", score_source="keyword"),
    ])
    a = compute_autonomy(data_dir, "c1")
    assert a["keyword_graded_rate"] == 0.5
    assert a["n_score_source_known"] == 2
