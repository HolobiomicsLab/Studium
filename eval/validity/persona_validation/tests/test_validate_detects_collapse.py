"""Two near-identical personas -> verdict 'flags' with a 'collapse' finding."""

from eval.validity.persona_validation.validate import validate_run
from eval.validity.persona_validation.tests._synth import write_run


def _full_branch_rules():
    # cover the expected adaptive branches so the ONLY finding is the collapse
    return ["graph_prereq_gate", "graph_universe_escalated"]


def test_collapse_detected_when_two_personas_near_identical(tmp_path):
    run = str(tmp_path / "run")
    # struggling and overconfident are byte-for-byte identical (the historical
    # "persona collapse" failure mode). proficient diverges from both.
    identical = dict(
        completed=True,
        n_turns=35,
        transition_kinds=["next", "remediate_alt", "next", "complete"],
        mastery={"c-a": 0.8, "c-b": 0.45},
        autonomy_ratio=0.6,
        rules_fired=_full_branch_rules(),
    )
    write_run(
        run,
        {
            "proficient": dict(
                completed=True,
                n_turns=15,
                transition_kinds=["next", "next", "complete"],
                mastery={"c-a": 0.86, "c-b": 0.86},
                autonomy_ratio=1.0,
                rules_fired=["rule_mastery_high_skip"],
            ),
            "struggling": dict(identical),
            "overconfident": dict(identical),
        },
    )

    card = validate_run(run)

    assert card["verdict"] == "flags"
    messages = [f["message"] for f in card["findings"]]
    assert any("collapse" in m.lower() for m in messages)
    # the collapse finding names the offending pair
    assert any(
        "collapse" in f["message"].lower()
        and "struggling" in f["message"]
        and "overconfident" in f["message"]
        for f in card["findings"]
    )
    # collapse is high severity (drives the 'flags' verdict)
    assert any(
        f["severity"] == "high" and "collapse" in f["message"].lower()
        for f in card["findings"]
    )


def test_divergence_checks_report_pair_scores(tmp_path):
    run = str(tmp_path / "run")
    identical = dict(
        transition_kinds=["next", "remediate_alt", "complete"],
        mastery={"c-a": 0.8, "c-b": 0.45},
        rules_fired=_full_branch_rules(),
    )
    write_run(
        run,
        {
            "struggling": dict(identical),
            "overconfident": dict(identical),
        },
    )
    card = validate_run(run)
    pairs = card["divergence"]["pairs"]
    key = next(iter(pairs))
    assert "collapse_score" in pairs[key]
    assert pairs[key]["collapse_score"] >= 0.98
