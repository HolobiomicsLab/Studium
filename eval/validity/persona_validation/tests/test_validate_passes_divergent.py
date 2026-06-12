"""Three genuinely divergent personas covering expected branches -> 'pass'."""

from eval.validity.persona_validation.validate import validate_run
from eval.validity.persona_validation.tests._synth import write_run


def _divergent_run(run):
    write_run(
        run,
        {
            # high mastery, autonomous, only 'next'+'complete'
            "proficient": dict(
                completed=True,
                n_turns=15,
                transition_kinds=["next"] * 14 + ["complete"],
                mastery={"c-a": 0.92, "c-b": 0.9, "c-c": 0.88},
                autonomy_ratio=1.0,
                rules_fired=["rule_mastery_high_skip"],
            ),
            # low mastery, lots of remediation, fires prereq gate
            "struggling": dict(
                completed=True,
                n_turns=35,
                transition_kinds=["next"] * 20 + ["remediate_alt"] * 5 + ["complete"],
                mastery={"c-a": 0.55, "c-b": 0.4, "c-c": 0.35},
                autonomy_ratio=0.5,
                rules_fired=["graph_prereq_gate", "rule_2err_replay_concept"],
            ),
            # mid mastery, escalates universe, distinct mix
            "overconfident": dict(
                completed=True,
                n_turns=25,
                transition_kinds=["next"] * 18 + ["remediate_alt"] * 2 + ["complete"],
                mastery={"c-a": 0.75, "c-b": 0.6, "c-c": 0.65},
                autonomy_ratio=0.75,
                rules_fired=["graph_universe_escalated", "rule_calibration_mismatch_show"],
            ),
        },
    )
    return run


def test_divergent_personas_pass(tmp_path):
    run = _divergent_run(str(tmp_path / "run"))
    card = validate_run(run)

    assert card["verdict"] == "pass", card["findings"]
    # no collapse finding
    assert not any("collapse" in f["message"].lower() for f in card["findings"])
    # no missing-branch finding (union covers the expected set)
    assert not any("missing" in f["message"].lower() for f in card["findings"])
    # no high-severity findings at all
    assert not any(f["severity"] == "high" for f in card["findings"])


def test_proficient_struggling_diverge(tmp_path):
    run = _divergent_run(str(tmp_path / "run"))
    card = validate_run(run)
    sig = card["personas"]
    assert sig["proficient"]["mean_mastery"] > sig["struggling"]["mean_mastery"]
    # transition mixes differ
    assert sig["proficient"]["transition_counts"] != sig["struggling"]["transition_counts"]


def test_signature_contains_expected_fields(tmp_path):
    run = _divergent_run(str(tmp_path / "run"))
    card = validate_run(run)
    s = card["personas"]["proficient"]
    for field in (
        "completed",
        "n_turns",
        "mean_mastery",
        "transition_counts",
        "autonomy_ratio",
        "rules_fired",
    ):
        assert field in s


def test_branch_coverage_union_reported(tmp_path):
    run = _divergent_run(str(tmp_path / "run"))
    card = validate_run(run)
    cov = card["branch_coverage"]
    assert "next" in cov["observed"]
    assert "remediate_alt" in cov["observed"]
    assert "complete" in cov["observed"]
    assert "graph_prereq_gate" in cov["observed"]
    assert "graph_universe_escalated" in cov["observed"]
    assert cov["missing"] == []


def test_honest_note_present(tmp_path):
    run = _divergent_run(str(tmp_path / "run"))
    card = validate_run(run)
    note = card["note"].lower()
    assert "internal" in note
    assert "ev-9b" in note or "real" in note
