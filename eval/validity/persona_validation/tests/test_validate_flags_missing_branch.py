"""Personas that never fire graph_prereq_gate -> a missing-branch finding."""

from eval.validity.persona_validation.validate import validate_run
from eval.validity.persona_validation.tests._synth import write_run


def test_missing_branch_flagged(tmp_path):
    run = str(tmp_path / "run")
    # Divergent enough to avoid collapse, all completed, BUT no graph_prereq_gate
    # anywhere in the union -> an expected branch is never exercised.
    write_run(
        run,
        {
            "proficient": dict(
                completed=True,
                n_turns=15,
                transition_kinds=["next"] * 14 + ["complete"],
                mastery={"c-a": 0.92, "c-b": 0.9},
                autonomy_ratio=1.0,
                rules_fired=["rule_mastery_high_skip"],
            ),
            "struggling": dict(
                completed=True,
                n_turns=30,
                transition_kinds=["next"] * 20 + ["remediate_alt"] * 5 + ["complete"],
                mastery={"c-a": 0.5, "c-b": 0.4},
                autonomy_ratio=0.5,
                # fires escalation but NOT graph_prereq_gate
                rules_fired=["graph_universe_escalated"],
            ),
        },
    )

    card = validate_run(run)

    findings = card["findings"]
    missing_findings = [f for f in findings if "missing" in f["message"].lower()]
    assert missing_findings, "expected a missing-branch finding"
    assert any("graph_prereq_gate" in f["message"] for f in missing_findings)

    cov = card["branch_coverage"]
    assert "graph_prereq_gate" in cov["missing"]
    # verdict flags because a known adaptive path is unexercised
    assert card["verdict"] == "flags"


def test_replay_is_allowed_but_not_required(tmp_path):
    """`replay` absence must NOT produce a missing-branch finding."""
    run = str(tmp_path / "run")
    write_run(
        run,
        {
            "proficient": dict(
                transition_kinds=["next", "complete"],
                mastery={"c-a": 0.9},
                rules_fired=["graph_prereq_gate", "graph_universe_escalated"],
            ),
            "struggling": dict(
                transition_kinds=["next", "remediate_alt", "complete"],
                mastery={"c-a": 0.4},
                rules_fired=["graph_prereq_gate"],
            ),
        },
    )
    card = validate_run(run)
    assert "replay" not in card["branch_coverage"]["missing"]


def test_incomplete_persona_flagged(tmp_path):
    run = str(tmp_path / "run")
    write_run(
        run,
        {
            "proficient": dict(
                completed=True,
                transition_kinds=["next", "complete"],
                mastery={"c-a": 0.9},
                rules_fired=["graph_prereq_gate", "graph_universe_escalated"],
            ),
            # hit the turn cap, never completed
            "struggling": dict(
                completed=False,
                n_turns=200,
                transition_kinds=["next", "remediate_alt", "next"],
                mastery={"c-a": 0.4},
                rules_fired=["graph_prereq_gate"],
            ),
        },
    )
    card = validate_run(run)
    assert any("complete" in f["message"].lower() for f in card["findings"])
    assert card["verdict"] == "flags"
