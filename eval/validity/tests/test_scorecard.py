"""Tests for scorecard.py — the committed record of ONE identified validity run.

Two properties carry the whole point of the file, and both are asserted here rather than
assumed: it is built from the reports' CONTENT and never from their filenames, and it refuses
to be written when it contains per-learner data. Everything else is presentation.
"""

import json

import pytest

from eval.validity import scorecard


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj))
    return path


def _validity_dir(tmp_path, run_id="05-deterministic-20260909-113535"):
    """A miniature `eval/validity/` holding one report per tool."""
    v = tmp_path / "validity"
    run_dir = f"eval/reports/{run_id}"
    _write(v / "kt_calibration" / "reports" / "20260909T114311.json",
           {"source": {"type": "csv", "n": 278336}, "beta_beats_running_mean": True,
            "results": {"beta": {"auc": 0.7, "brier": 0.2, "n": 278336}}})
    _write(v / "persona_validation" / "reports" / f"{run_id}.json",
           {"run_dir": run_dir, "verdict": "pass",
            "personas": {"hint_reliant": {"completed": True, "n_turns": 17}},
            "divergence": {"max_collapse_score": 0.93},
            "branch_coverage": {"missing": []}, "findings": []})
    _write(v / "grounding_relevance" / "reports" / "05-bundle.json",
           {"bundle": f"{run_dir}/05-bundle.zip", "verdict": "relevant",
            "n_evidenced_scenes": 4, "mean_best_relevance": 0.08,
            "relevance_grade": 0.5, "threshold": 0.06})
    _write(v / "bea_tutor" / "reports" / "05-bundle.json",
           {"bundle": f"{run_dir}/05-bundle.zip", "n_moves": 27, "reveal_rate": 0.0,
            "actionability_rate": 0.44, "summative_safe_rate": 1.0})
    _write(v / "reasoning_depth" / "reports" / f"{run_id}.json",
           {"run_dir": run_dir, "verdict": {"anti_offloading_ok": True},
            "trajectory": {"n_signals": 0, "depth_slope": None, "signal_entropy": 0.0},
            "contingency": {"n_moves": 0, "reveal_violations": 0}})
    return v, run_dir


def test_build_names_the_run_and_reads_every_tool(tmp_path):
    v, run_dir = _validity_dir(tmp_path)
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    assert card["run_id"] == "05-deterministic-20260909-113535"
    assert card["corpus"] == "05" and card["author_mode"] == "deterministic"
    assert set(card["tools"]) == set(scorecard.TOOLS)
    assert all(t["status"] == "ok" for t in card["tools"].values())
    # The claim manuscript §8 rests on, recorded per persona: a count would hide WHICH one.
    assert card["tools"]["persona_validation"]["headline"]["completed"] == {"hint_reliant": True}


def test_a_report_is_matched_on_its_content_and_never_on_its_filename(tmp_path):
    """`grounding_relevance` and `bea_tutor` name their file after the BUNDLE, so
    `05-bundle.json` belongs to whichever course-05 run finished last. Matching on the
    filename would silently attribute an earlier run's numbers to this one — the exact defect
    INT-STUDIUM-002 was filed on."""
    v, run_dir = _validity_dir(tmp_path)
    stale = v / "grounding_relevance" / "reports" / "05-bundle.json"
    _write(stale, {"bundle": "eval/reports/05-claude-20260615-203632/05-bundle.zip",
                   "verdict": "relevant", "relevance_grade": 1.0})
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    entry = card["tools"]["grounding_relevance"]
    assert entry["status"] == "missing"
    assert entry["attributed_to_run"] is False
    assert entry["source_report"] is None
    # And the stale number does not appear anywhere in the scorecard.
    assert "1.0" not in json.dumps(entry["headline"])


def test_the_digest_is_what_makes_an_overwritten_report_checkable(tmp_path):
    """The two bundle-named reports are overwritten in place by the next run of the same
    course. The scorecard cannot prevent that; what it can do is record the digest of the file
    it actually read, so a later reader can tell whether the file still holds these numbers."""
    v, run_dir = _validity_dir(tmp_path)
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    path = tmp_path / card["tools"]["bea_tutor"]["source_report"]
    assert card["tools"]["bea_tutor"]["source_sha256"] == scorecard.sha256(path)
    path.write_text(path.read_text().replace('"n_moves": 27', '"n_moves": 99'))
    assert card["tools"]["bea_tutor"]["source_sha256"] != scorecard.sha256(path)


def test_kt_calibration_is_recorded_as_run_independent(tmp_path):
    """It validates the learner model against ASSISTments, not against this run. Reporting it
    as "attributed to this run" would be a false precision — the number is the same for every
    run id, and a reader comparing two scorecards would read a constant as a replication."""
    v, run_dir = _validity_dir(tmp_path)
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    entry = card["tools"]["kt_calibration"]
    assert entry["attributed_to_run"] is None
    assert entry["source_report"] is not None
    assert "external dataset" in entry["note"]


def test_a_flagged_tool_is_recorded_as_flagged(tmp_path):
    """Exit 1 means the tool flagged something. The scorecard reports it; it does not decide."""
    v, run_dir = _validity_dir(tmp_path)
    codes = dict.fromkeys(scorecard.TOOLS, 0)
    codes["persona_validation"] = 1
    card = scorecard.build(run_dir, v, tmp_path, codes)
    assert card["tools"]["persona_validation"]["status"] == "flagged"
    assert card["tools"]["persona_validation"]["headline"]["verdict"] == "pass"


@pytest.mark.parametrize("payload", [
    {"tools": {"persona_validation": {"learner_pseudonym": "x"}}},
    {"tools": {"persona_validation": {"sessions": []}}},
    {"tools": {"persona_validation": {"headline": {"final_concept_mastery": {}}}}},
    {"tools": {"persona_validation": {"headline": {"who": "ac2a5eaa830e189c"}}}},
])
def test_learner_data_is_refused_before_a_write(tmp_path, payload):
    """`eval/reports/` is gitignored because it carries per-learner state; this file is
    committed. The guard denies the KEY rather than filtering it out — a scorecard that
    silently dropped the learner half of a structure was still built by an extractor that
    thought copying it was in bounds."""
    with pytest.raises(scorecard.LearnerDataError):
        scorecard.write(payload, tmp_path / "SCORECARD.json")
    assert not (tmp_path / "SCORECARD.json").exists()


def test_a_sha256_is_not_mistaken_for_a_pseudonym(tmp_path):
    """A `learner_pseudonym` is 16 hex characters and a digest is 64. The shape is checked
    exactly, because a guard that rejected all hex would reject the digests that are the
    reason this file exists."""
    scorecard.assert_no_learner_data({"source_sha256": "a" * 64})
    with pytest.raises(scorecard.LearnerDataError):
        scorecard.assert_no_learner_data({"source_sha256": "a" * 16})


def test_written_scorecard_round_trips_and_the_markdown_names_the_run(tmp_path):
    v, run_dir = _validity_dir(tmp_path)
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    j, m = tmp_path / "SCORECARD.json", tmp_path / "SCORECARD.md"
    scorecard.write(card, j, m)
    assert json.loads(j.read_text())["run_id"] == card["run_id"]
    md = m.read_text()
    assert card["run_id"] in md
    assert "kt_calibration" in md and "n/a" in md  # run-independent renders as n/a, not "no"


def test_the_markdown_marks_an_unattributed_tool_loudly(tmp_path):
    v, run_dir = _validity_dir(tmp_path)
    _write(v / "bea_tutor" / "reports" / "05-bundle.json",
           {"bundle": "eval/reports/05-claude-20260615-203632/05-bundle.zip", "n_moves": 1})
    card = scorecard.build(run_dir, v, tmp_path, {t: 0 for t in scorecard.TOOLS})
    md = scorecard.render_md(card)
    # A missing attribution has to be readable at a glance in the table; a scorecard whose
    # gaps are only visible in the JSON is a scorecard whose gaps are not visible.
    assert "**no**" in md
