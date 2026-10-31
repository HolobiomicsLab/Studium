"""Contract tests for the practical diagnosis and robustness templates."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from experience_templates import prepare_activity, validate_prepared_activity
from learner_trace import validate_trace_payload


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "activity-templates"


def write_json(path: Path, value: object) -> None:
    """Write a JSON fixture without normalizing exceptional numbers."""
    path.write_text(json.dumps(value), encoding="utf-8")


@pytest.fixture
def public_context(tmp_path: Path) -> Path:
    """Return a minimal public scene context for template preparation."""
    path = tmp_path / "context.json"
    write_json(
        path,
        {
            "schema": "studium/operator-context/v1",
            "scene": {
                "id": "scene_practical",
                "title": "Inspect a captured result",
                "objective_refs": ["reason_from_results"],
            },
        },
    )
    return path


def load_sample(template_id: str) -> dict:
    """Load a detached sample config for one practical template."""
    path = EXAMPLES / template_id / "config.json"
    return json.loads(path.read_text(encoding="utf-8"))


def prepare_config(
    tmp_path: Path, public_context: Path, template_id: str, config: dict
) -> dict:
    """Prepare and return a practical activity from an explicit config."""
    config_path = tmp_path / f"{template_id}.json"
    output = tmp_path / f"{template_id}-output"
    write_json(config_path, config)
    prepare_activity(template_id, public_context, output, config_path)
    activity = json.loads((output / "activity.json").read_text(encoding="utf-8"))
    return validate_prepared_activity(activity)


@pytest.mark.parametrize("template_id", ["diagnose-analysis", "conclusion-robustness"])
def test_checked_practical_samples_prepare_as_captured_results(
    public_context: Path, tmp_path: Path, template_id: str
) -> None:
    activity = prepare_config(tmp_path, public_context, template_id, load_sample(template_id))
    assert activity["template_id"] == template_id
    assert activity["template_version"] == "1.0.0"
    assert activity["data_status"] == "synthetic teaching fixture"
    assert "execute" not in activity["config"]
    assert "code" not in activity["config"]


DOMAIN_CASES = [
    pytest.param("diagnose-analysis", "population ecology", {}, id="ecology-positive"),
    pytest.param(
        "diagnose-analysis",
        "analytical chemistry",
        {
            "steps": [
                {"id": "read_blank", "label": "Read blank", "description": "Inspect the supplied blank response."},
                {"id": "subtract_blank", "label": "Subtract blank", "description": "Subtract the blank from the captured sample response."},
            ],
            "repairs": [
                {"id": "subtract_supplied_blank", "label": "Subtract supplied blank", "explanation": "Use the captured blank value before reporting concentration.", "result": 0.0},
                {"id": "retain_negative", "label": "Retain uncorrected value", "explanation": "Keep the captured uncorrected negative result for comparison.", "result": -0.4},
            ],
            "flawed_result": -1.2,
            "result_unit": "mg/L",
            "supported_repair_id": "subtract_supplied_blank",
            "oracle": {"repaired_result": 0.0},
        },
        id="chemistry-negative-zero",
    ),
    pytest.param("conclusion-robustness", "materials science", {}, id="materials-gte-some"),
    pytest.param(
        "conclusion-robustness",
        "epidemiology",
        {
            "scenarios": [
                {"id": "age_adjusted", "label": "Age-adjusted", "assumption": "Use the supplied age-adjusted estimate.", "value": -1.0},
                {"id": "unadjusted", "label": "Unadjusted", "assumption": "Use the supplied unadjusted estimate.", "value": 0.0},
            ],
            "baseline_scenario_id": "age_adjusted",
            "metric": {"label": "Risk difference", "unit": "percentage points"},
            "decision": {"operator": "lte", "threshold": 0.0, "claim": "The supplied risk difference is no greater than zero."},
            "oracle": {"supporting_scenario_ids": ["age_adjusted", "unadjusted"]},
        },
        id="epidemiology-lte-all",
    ),
    pytest.param(
        "conclusion-robustness",
        "astrophysics",
        {
            "scenarios": [
                {"id": "local_background", "label": "Local background", "assumption": "Use the supplied local-background subtraction.", "value": 0.0},
                {"id": "global_background", "label": "Global background", "assumption": "Use the supplied global-background subtraction.", "value": -0.2},
            ],
            "baseline_scenario_id": "local_background",
            "metric": {"label": "Normalized excess", "unit": "z score"},
            "decision": {"operator": "gte", "threshold": 1.0, "claim": "The supplied excess reaches the teaching threshold."},
            "oracle": {"supporting_scenario_ids": []},
        },
        id="astrophysics-gte-none",
    ),
]


@pytest.mark.parametrize("template_id,domain_label,variant", DOMAIN_CASES)
def test_practical_contracts_accept_structurally_distinct_sciences(
    public_context: Path, tmp_path: Path, template_id: str, domain_label: str, variant: dict
) -> None:
    config = load_sample(template_id)
    config.update(copy.deepcopy(variant))
    config["scope"] = f"Reason from supplied captured values in {domain_label}."
    config["source"]["title"] = f"Synthetic {domain_label} fixture"
    config["source"]["statement"] = f"Invented captured values for a {domain_label} lesson."
    activity = prepare_config(tmp_path, public_context, template_id, config)
    assert domain_label in activity["scope"]
    assert activity["config"]["source"]["title"] == f"Synthetic {domain_label} fixture"


@pytest.mark.parametrize(
    "template_id,domain_label",
    [
        ("diagnose-analysis", "cryosphere field log"),
        ("conclusion-robustness", "forest inventory archive"),
    ],
)
def test_practical_contracts_accept_supplied_source_backed_shapes(
    public_context: Path, tmp_path: Path, template_id: str, domain_label: str
) -> None:
    config = load_sample(template_id)
    config["data_status"] = "supplied source-backed data"
    config["source"] = {
        "id": "supplied_public_record",
        "title": domain_label,
        "locator": "https://example.edu/public-record",
        "source_kind": "supplied_evidence",
        "statement": "Public values transcribed into the activity configuration.",
    }
    activity = prepare_config(tmp_path, public_context, template_id, config)
    assert activity["data_status"] == "supplied source-backed data"
    assert activity["config"]["source"]["title"] == domain_label


def test_practical_choice_prefixes_fit_the_shared_trace_contract() -> None:
    diagnosis = load_sample("diagnose-analysis")
    robustness = load_sample("conclusion-robustness")
    choices = [
        f"step_{diagnosis['steps'][0]['id']}",
        f"repair_{diagnosis['repairs'][0]['id']}",
        f"scenario_{robustness['scenarios'][0]['id']}",
    ]
    events = [
        {
            "sequence": 1,
            "recorded_at": "2026-09-11T10:00:00Z",
            "actor": "learner",
            "origin": "browser_observed",
            "kind": "activity_started",
            "data": {},
        }
    ]
    for sequence, choice_id in enumerate(choices, start=2):
        events.append(
            {
                "sequence": sequence,
                "recorded_at": f"2026-09-11T10:00:0{sequence - 1}Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "learner_choice_selected",
                "data": {"choice_id": choice_id},
            }
        )
    trace = {
        "schema": "studium/learner-actions/v1",
        "activity_id": "activity_practical",
        "template_id": "diagnose-analysis",
        "template_version": "1.0.0",
        "scene_id": "scene_practical",
        "events": events,
    }
    validated = validate_trace_payload(trace)
    assert [event.data.choice_id for event in validated.events[1:]] == choices


DIAGNOSIS_CASES = [
    pytest.param(lambda c: c.update(extra="private"), "unknown", id="closed-config"),
    pytest.param(lambda c: c.update(steps=c["steps"][:1]), "at least two", id="two-steps"),
    pytest.param(lambda c: c["steps"][0].update(extra="private"), "step.*unknown", id="closed-step"),
    pytest.param(lambda c: c["steps"][0].update(id="bad:id"), "step ID", id="step-id"),
    pytest.param(lambda c: c["steps"][0].update(id="s" * 116), "choice ID", id="step-prefixed-id"),
    pytest.param(lambda c: c["steps"][0].update(label=" "), "step", id="step-label"),
    pytest.param(lambda c: c["steps"][0].update(description=""), "step", id="step-description"),
    pytest.param(lambda c: c["steps"][1].update(id=c["steps"][0]["id"]), "unique", id="step-unique"),
    pytest.param(lambda c: c.update(repairs=c["repairs"][:1]), "at least two", id="two-repairs"),
    pytest.param(lambda c: c["repairs"][0].update(extra="private"), "repair.*unknown", id="closed-repair"),
    pytest.param(lambda c: c["repairs"][0].update(id="bad:id"), "repair ID", id="repair-id"),
    pytest.param(lambda c: c["repairs"][0].update(id="r" * 114), "choice ID", id="repair-prefixed-id"),
    pytest.param(lambda c: c["repairs"][0].update(label=""), "repair", id="repair-label"),
    pytest.param(lambda c: c["repairs"][0].update(explanation=" "), "repair", id="repair-explanation"),
    pytest.param(lambda c: c["repairs"][1].update(id=c["repairs"][0]["id"]), "unique", id="repair-unique"),
    pytest.param(lambda c: c["repairs"][0].update(result=True), "finite", id="repair-result-bool"),
    pytest.param(lambda c: c["repairs"][0].update(result=float("inf")), "finite", id="repair-result-infinite"),
    pytest.param(lambda c: c["repairs"][0].update(result=10**400), "finite", id="repair-result-overflow"),
    pytest.param(lambda c: c.update(flawed_result=False), "finite", id="flawed-result-bool"),
    pytest.param(lambda c: c.update(flawed_result=float("nan")), "finite", id="flawed-result-nan"),
    pytest.param(lambda c: c.update(result_unit=" "), "unit", id="result-unit"),
    pytest.param(lambda c: c.update(supported_repair_id="missing"), "reference", id="repair-reference"),
    pytest.param(lambda c: c["oracle"].update(extra=1), "oracle.*unknown", id="closed-oracle"),
    pytest.param(lambda c: c["oracle"].update(repaired_result=float("inf")), "finite", id="oracle-finite"),
    pytest.param(lambda c: c["oracle"].update(repaired_result=-999), "match", id="oracle-match"),
]


@pytest.mark.parametrize("mutation,match", DIAGNOSIS_CASES)
def test_diagnosis_rejects_invalid_or_ambiguous_configs(
    public_context: Path, tmp_path: Path, mutation, match: str
) -> None:
    config = copy.deepcopy(load_sample("diagnose-analysis"))
    mutation(config)
    config_path = tmp_path / "invalid-diagnosis.json"
    output = tmp_path / "invalid-diagnosis"
    write_json(config_path, config)
    with pytest.raises(ValueError, match=match):
        prepare_activity("diagnose-analysis", public_context, output, config_path)
    assert not output.exists()


ROBUSTNESS_CASES = [
    pytest.param(lambda c: c.update(extra="private"), "unknown", id="closed-config"),
    pytest.param(lambda c: c.update(scenarios=c["scenarios"][:1]), "at least two", id="two-scenarios"),
    pytest.param(lambda c: c["scenarios"][0].update(extra="private"), "scenario.*unknown", id="closed-scenario"),
    pytest.param(lambda c: c["scenarios"][0].update(id="bad:id"), "scenario ID", id="scenario-id"),
    pytest.param(lambda c: c["scenarios"][0].update(id="s" * 112), "choice ID", id="scenario-prefixed-id"),
    pytest.param(lambda c: c["scenarios"][0].update(label=" "), "scenario", id="scenario-label"),
    pytest.param(lambda c: c["scenarios"][0].update(assumption=""), "scenario", id="scenario-assumption"),
    pytest.param(lambda c: c["scenarios"][1].update(id=c["scenarios"][0]["id"]), "unique", id="scenario-unique"),
    pytest.param(lambda c: c["scenarios"][0].update(value=True), "finite", id="scenario-value-bool"),
    pytest.param(lambda c: c["scenarios"][0].update(value=float("inf")), "finite", id="scenario-value-infinite"),
    pytest.param(lambda c: c["scenarios"][0].update(value=10**400), "finite", id="scenario-value-overflow"),
    pytest.param(lambda c: c.update(baseline_scenario_id="missing"), "reference", id="baseline-reference"),
    pytest.param(lambda c: c["metric"].update(extra="private"), "metric.*unknown", id="closed-metric"),
    pytest.param(lambda c: c["metric"].update(label=""), "metric", id="metric-label"),
    pytest.param(lambda c: c["metric"].update(unit=" "), "metric", id="metric-unit"),
    pytest.param(lambda c: c["decision"].update(extra="private"), "decision.*unknown", id="closed-decision"),
    pytest.param(lambda c: c["decision"].update(operator="gt"), "operator", id="operator"),
    pytest.param(lambda c: c["decision"].update(operator=[]), "operator", id="operator-wrong-type"),
    pytest.param(lambda c: c["decision"].update(threshold=False), "finite", id="threshold-bool"),
    pytest.param(lambda c: c["decision"].update(threshold=float("nan")), "finite", id="threshold-nan"),
    pytest.param(lambda c: c["decision"].update(threshold=10**400), "finite", id="threshold-overflow"),
    pytest.param(lambda c: c["decision"].update(claim=" "), "claim", id="decision-claim"),
    pytest.param(lambda c: c["oracle"].update(extra=[]), "oracle.*unknown", id="closed-oracle"),
    pytest.param(lambda c: c["oracle"].update(supporting_scenario_ids="nominal"), "array", id="oracle-array"),
    pytest.param(lambda c: c["oracle"].update(supporting_scenario_ids=["missing"]), "reference", id="oracle-reference"),
    pytest.param(lambda c: c["oracle"].update(supporting_scenario_ids=[]), "match", id="oracle-match"),
    pytest.param(lambda c: c["oracle"].update(supporting_scenario_ids=list(reversed(c["oracle"]["supporting_scenario_ids"]))), "match", id="oracle-order"),
]


@pytest.mark.parametrize("mutation,match", ROBUSTNESS_CASES)
def test_robustness_rejects_invalid_or_ambiguous_configs(
    public_context: Path, tmp_path: Path, mutation, match: str
) -> None:
    config = copy.deepcopy(load_sample("conclusion-robustness"))
    mutation(config)
    config_path = tmp_path / "invalid-robustness.json"
    output = tmp_path / "invalid-robustness"
    write_json(config_path, config)
    with pytest.raises(ValueError, match=match):
        prepare_activity("conclusion-robustness", public_context, output, config_path)
    assert not output.exists()
