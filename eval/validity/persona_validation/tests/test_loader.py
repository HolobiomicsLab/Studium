"""Tests for loader.py — parse PersonaRecords from a run dir."""

from eval.validity.persona_validation.loader import load_run
from eval.validity.persona_validation.tests._synth import write_run


def test_load_run_parses_records(tmp_path):
    run = str(tmp_path / "run")
    write_run(
        run,
        {
            "proficient": dict(
                completed=True,
                n_turns=15,
                transition_kinds=["next", "next", "complete"],
                mastery={"c-a": 0.86, "c-b": 0.84},
                autonomy_ratio=1.0,
                rules_fired=["rule_mastery_high_skip"],
            ),
            "struggling": dict(
                completed=True,
                n_turns=35,
                transition_kinds=["next", "remediate_alt", "complete"],
                mastery={"c-a": 0.5, "c-b": 0.45},
                autonomy_ratio=0.6,
                rules_fired=["graph_prereq_gate", "graph_prereq_gate"],
            ),
        },
    )

    records = load_run(run)
    assert set(records) == {"proficient", "struggling"}

    p = records["proficient"]
    assert p.persona == "proficient"
    assert p.completed is True
    assert p.n_turns == 15
    assert p.transition_kinds == ["next", "next", "complete"]
    assert p.transition_counts == {"next": 2, "complete": 1}
    assert p.autonomy_ratio == 1.0
    # mastery is alpha/(alpha+beta); synth backs out alpha/beta from these
    assert abs(p.mastery["c-a"] - 0.86) < 1e-6
    assert abs(p.mastery["c-b"] - 0.84) < 1e-6
    assert p.rules_fired == {"rule_mastery_high_skip"}


def test_load_run_collects_rules_fired_set(tmp_path):
    run = str(tmp_path / "run")
    write_run(
        run,
        {
            "struggling": dict(
                rules_fired=[
                    "graph_prereq_gate",
                    "graph_prereq_gate",
                    "graph_universe_escalated",
                    "rule_2err_replay_concept",
                ],
            ),
        },
    )
    rec = load_run(run)["struggling"]
    # deduped to a set
    assert rec.rules_fired == {
        "graph_prereq_gate",
        "graph_universe_escalated",
        "rule_2err_replay_concept",
    }


def test_load_run_defensive_missing_telemetry(tmp_path):
    """A session with driver_result.json but no telemetry.jsonl must not crash."""
    run = str(tmp_path / "run")
    sess = write_run(run, {"proficient": dict(rules_fired=["graph_prereq_gate"])})
    import os

    os.remove(os.path.join(run, "sessions", "proficient", "telemetry.jsonl"))

    rec = load_run(run)["proficient"]
    assert rec.rules_fired == set()
    assert rec.persona == "proficient"


def test_load_run_defensive_missing_fields(tmp_path):
    """Missing driver_result fields fall back to sensible defaults, no crash."""
    import json
    import os

    run = str(tmp_path / "run")
    sess = os.path.join(run, "sessions", "weird")
    os.makedirs(sess)
    with open(os.path.join(sess, "driver_result.json"), "w") as fh:
        json.dump({"persona": "weird"}, fh)

    rec = load_run(run)["weird"]
    assert rec.persona == "weird"
    assert rec.completed is False
    assert rec.n_turns == 0
    assert rec.transition_kinds == []
    assert rec.transition_counts == {}
    assert rec.mastery == {}
    assert rec.rules_fired == set()


def test_load_run_missing_dir_returns_empty(tmp_path):
    rec = load_run(str(tmp_path / "does-not-exist"))
    assert rec == {}
