"""Tests for the reusable, local-only activity-template preparer."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from experience_templates import (
    CATALOGUE_SCHEMA,
    PreparedActivity,
    list_templates,
    prepare_activity,
    validate_prepared_activity,
)
from learner_trace import validate_trace_payload


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples" / "activity-templates"


def write_json(path: Path, value: object) -> None:
    """Write a compact JSON test fixture."""
    path.write_text(json.dumps(value), encoding="utf-8")


@pytest.fixture
def public_context(tmp_path: Path) -> Path:
    """Return a minimal checked Studium public scene context."""
    path = tmp_path / "context.json"
    write_json(
        path,
        {
            "schema": "studium/operator-context/v1",
            "session_id": "local-session",
            "scene": {
                "id": "scene_01",
                "title": "Compare evidence",
                "objective_refs": ["judge_support"],
                "source_content": "A public source excerpt supplied to the learner.",
            },
            "run_manifest": None,
        },
    )
    return path


def test_catalogue_distinguishes_three_ready_and_two_proposed_templates() -> None:
    catalogue = list_templates()
    assert catalogue["schema"] == CATALOGUE_SCHEMA
    assert [item["id"] for item in catalogue["templates"]] == [
        "linked-representations",
        "parameter-comparison",
        "evidence-claim",
        "diagnose-analysis",
        "conclusion-robustness",
    ]
    assert [item["status"] for item in catalogue["templates"]].count("ready") == 3
    assert [item["status"] for item in catalogue["templates"]].count("proposed") == 2
    for item in catalogue["templates"]:
        assert item["learning_goal"]
        assert item["version"] == "1.0.0"
        if item["status"] == "ready":
            assert item["sample_config"]
        else:
            assert item["sample_config"] is None


@pytest.mark.parametrize(
    "template_id",
    ["linked-representations", "parameter-comparison", "evidence-claim"],
)
def test_prepare_creates_a_browsable_task_from_public_context(
    public_context: Path, tmp_path: Path, template_id: str
) -> None:
    output = tmp_path / template_id
    prepared = prepare_activity(template_id, public_context, output)
    assert isinstance(prepared, PreparedActivity)
    assert prepared.output_dir == output
    assert sorted(path.name for path in output.iterdir()) == [
        "activity.json",
        "index.html",
        "learner-actions.schema.json",
        "provenance.json",
        "task.md",
    ]
    activity = json.loads((output / "activity.json").read_text(encoding="utf-8"))
    assert activity["template_id"] == template_id
    assert activity["scene_id"] == "scene_01"
    assert activity["data_status"] == "synthetic teaching fixture"
    assert activity["expected_source_inputs"]
    assert activity["independent_checks"]
    task = (output / "task.md").read_text(encoding="utf-8")
    assert "Scope" in task and "Expected source inputs" in task
    assert "Independent checks" in task and "teacher review" in task.lower()
    html = (output / "index.html").read_text(encoding="utf-8")
    assert "Predict" in html and "Reveal" in html and "Export activity trace" in html
    assert "localStorage" not in html and "fetch(" not in html
    schema = json.loads((output / "learner-actions.schema.json").read_text(encoding="utf-8"))
    assert schema["$defs"]


def test_linked_template_reuses_the_checked_numeric_core(
    public_context: Path, tmp_path: Path
) -> None:
    output = tmp_path / "linked"
    prepare_activity("linked-representations", public_context, output)
    activity = json.loads((output / "activity.json").read_text(encoding="utf-8"))
    assert activity["engine"]["module"] == "examples/literature-experience/linked-viewer-core.mjs"
    html = (output / "index.html").read_text(encoding="utf-8")
    core = (ROOT / activity["engine"]["module"]).read_text(encoding="utf-8")
    assert "function calculateNetwork" in html
    assert activity["engine"]["sha256"]
    assert "function candidatePairs" not in (ROOT / "tools" / "experience_templates.py").read_text(
        encoding="utf-8"
    )
    assert "export function calculateNetwork" in core


def test_prepare_rejects_proposed_template_unknown_context_and_existing_output(
    public_context: Path, tmp_path: Path
) -> None:
    with pytest.raises(ValueError, match="proposed"):
        prepare_activity("diagnose-analysis", public_context, tmp_path / "proposal")
    private_context = tmp_path / "private.json"
    write_json(
        private_context,
        {
            "schema": "studium/operator-context/v1",
            "scene": {"id": "scene_01", "answer_key": "PRIVATE"},
        },
    )
    with pytest.raises(ValueError, match="outside the public"):
        prepare_activity("evidence-claim", private_context, tmp_path / "private")
    output = tmp_path / "existing"
    output.mkdir()
    with pytest.raises(FileExistsError):
        prepare_activity("parameter-comparison", public_context, output)


def test_scene_binding_is_preserved_while_each_activity_id_is_fresh(tmp_path: Path) -> None:
    context = tmp_path / "unicode-context.json"
    write_json(context, {"schema": "studium/operator-context/v1", "scene": {"id": "scène / analyse 01"}})
    first, second = tmp_path / "first", tmp_path / "second"
    prepare_activity("evidence-claim", context, first)
    prepare_activity("evidence-claim", context, second)
    first_activity = json.loads((first / "activity.json").read_text(encoding="utf-8"))
    second_activity = json.loads((second / "activity.json").read_text(encoding="utf-8"))
    assert first_activity["scene_id"] == "scène / analyse 01"
    assert first_activity["activity_id"] != second_activity["activity_id"]
    assert first_activity["activity_id"].isascii()


def test_prepare_accepts_the_current_public_journal_descriptor(tmp_path: Path) -> None:
    context = tmp_path / "current-context.json"
    write_json(context, {
        "schema": "studium/operator-context/v1", "scene": {"id": "scene-current"},
        "exploration": {"capabilities": "discover-in-current-harness", "workflow": ["predict"],
            "recordTool": "tools/experience_exploration.py", "instructions": "Public instructions",
            "journal": {"record_tool": "record_experiment", "read_tool": "get_experiment_journal",
                "file": "experiment-action.json", "snapshot": "experiment.json",
                "sequence": ["predict", "begin", "observe", "conclude"],
                "instructions": "Opt-in public journal instructions."}}
    })
    output = tmp_path / "prepared-current"
    prepare_activity("evidence-claim", context, output)
    assert (output / "index.html").exists()


@pytest.mark.parametrize(
    "mutation,match",
    [
        (lambda value: value.update(secret_note="PRIVATE"), "unknown"),
        (lambda value: value["parameter"].update(max=float("inf")), "finite"),
        (lambda value: value["independent_checks"][0].pop("description"), "independent check"),
    ],
)
def test_explicit_config_is_closed_and_finite(
    public_context: Path, tmp_path: Path, mutation, match: str
) -> None:
    config = json.loads(
        (EXAMPLES / "parameter-comparison" / "config.json").read_text(encoding="utf-8")
    )
    mutation(config)
    config_path = tmp_path / "config.json"
    write_json(config_path, config)
    output = tmp_path / "output"
    with pytest.raises(ValueError, match=match):
        prepare_activity("parameter-comparison", public_context, output, config_path)
    assert not output.exists()


def test_prepared_activity_validator_rejects_unknown_fields_and_preserves_controls(
    public_context: Path, tmp_path: Path
) -> None:
    output = tmp_path / "prepared"
    prepare_activity("parameter-comparison", public_context, output)
    activity = json.loads((output / "activity.json").read_text(encoding="utf-8"))
    validated = validate_prepared_activity(activity)
    assert validated["config"]["parameter"]["baseline"] == 1.5
    assert validated["config"]["model"]["fixed_input"] == 4.0
    activity["config"]["private_note"] = "must not pass"
    with pytest.raises(ValueError, match="unknown"):
        validate_prepared_activity(activity)


def test_linked_config_rejects_nested_private_fields_before_embedding(
    public_context: Path, tmp_path: Path
) -> None:
    network = json.loads(
        (ROOT / "examples/literature-experience/linked-network.json").read_text(encoding="utf-8")
    )
    network["private_note"] = "must not cross the public viewer boundary"
    write_json(tmp_path / "network.json", network)
    config = json.loads(
        (EXAMPLES / "linked-representations/config.json").read_text(encoding="utf-8")
    )
    config["network_file"] = "network.json"
    write_json(tmp_path / "config.json", config)
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="unknown"):
        prepare_activity("linked-representations", public_context, output, tmp_path / "config.json")
    assert not output.exists()


def test_cli_lists_and_prepares_without_running_or_submitting(
    public_context: Path, tmp_path: Path
) -> None:
    listing = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "experience_templates.py"), "list", "--json"],
        check=True,
        text=True,
        capture_output=True,
    )
    assert json.loads(listing.stdout)["schema"] == CATALOGUE_SCHEMA
    output = tmp_path / "prepared"
    prepared = subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "experience_templates.py"),
            "prepare",
            "--template",
            "parameter-comparison",
            "--context",
            str(public_context),
            "--out",
            str(output),
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    assert Path(prepared.stdout.strip()) == output.resolve()
    assert not (output / "response.json").exists()


def test_browser_style_trace_fixture_validates_with_shared_contract() -> None:
    payload = {
        "schema": "studium/learner-actions/v1",
        "activity_id": "parameter-comparison-scene_01",
        "template_id": "parameter-comparison",
        "template_version": "1.0.0",
        "scene_id": "scene_01",
        "events": [
            {
                "sequence": 1,
                "recorded_at": "2026-09-11T10:00:00Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "activity_started",
                "data": {},
            },
            {
                "sequence": 2,
                "recorded_at": "2026-09-11T10:00:01Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "learner_text_submitted",
                "data": {"phase": "prediction", "text": "The signal should rise."},
            },
            {
                "sequence": 3,
                "recorded_at": "2026-09-11T10:00:02Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "results_revealed",
                "data": {},
            },
            {
                "sequence": 4,
                "recorded_at": "2026-09-11T10:00:03Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "parameter_changed",
                "data": {"parameter_id": "variation_value", "before": 15.0, "after": 14.0},
            },
            {
                "sequence": 5,
                "recorded_at": "2026-09-11T10:00:04Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "learner_text_submitted",
                "data": {"phase": "observation", "text": "The difference became smaller."},
            },
            {
                "sequence": 6,
                "recorded_at": "2026-09-11T10:00:05Z",
                "actor": "learner",
                "origin": "browser_observed",
                "kind": "activity_completed",
                "data": {},
            },
        ],
    }
    assert validate_trace_payload(payload).schema_id == "studium/learner-actions/v1"
