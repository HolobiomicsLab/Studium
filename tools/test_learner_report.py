"""Local learner-report export, privacy and conformance tests."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

from experience_templates import activity_digest
from learner_report import ReportError, export_learner_report, verify_learner_report
from learner_trace import SCHEMA_ID


def activity(scene_id: str = "scene_01") -> dict:
    """One complete synthetic learner activity with declared harness assistance."""
    return {
        "schema": SCHEMA_ID,
        "activity_id": "activity_01",
        "template_id": "parameter-comparison",
        "template_version": "1.0.0",
        "scene_id": scene_id,
        "events": [
            {"sequence": 1, "recorded_at": "2026-09-11T10:00:01Z", "actor": "learner", "origin": "browser_observed", "kind": "activity_started", "data": {}},
            {"sequence": 2, "recorded_at": "2026-09-11T10:00:02Z", "actor": "learner", "origin": "browser_observed", "kind": "learner_text_submitted", "data": {"phase": "prediction", "text": "  exact learner prediction\n", "confidence": 2}},
            {"sequence": 3, "recorded_at": "2026-09-11T10:00:03Z", "actor": "learner", "origin": "browser_observed", "kind": "assistance_requested", "data": {"text": "Explain the control"}},
            {"sequence": 4, "recorded_at": "2026-09-11T10:00:04Z", "actor": "harness", "origin": "harness_declared", "kind": "assistance_provided", "data": {"text": "Hold node membership fixed."}},
            {"sequence": 5, "recorded_at": "2026-09-11T10:00:05Z", "actor": "learner", "origin": "browser_observed", "kind": "results_revealed", "data": {}},
            {"sequence": 6, "recorded_at": "2026-09-11T10:00:06Z", "actor": "learner", "origin": "browser_observed", "kind": "learner_text_submitted", "data": {"phase": "observation", "text": "<script>alert(1)</script>"}},
            {"sequence": 7, "recorded_at": "2026-09-11T10:00:07Z", "actor": "learner", "origin": "browser_observed", "kind": "learner_text_submitted", "data": {"phase": "conclusion", "text": "Similarity is not identity"}},
            {"sequence": 8, "recorded_at": "2026-09-11T10:00:08Z", "actor": "learner", "origin": "browser_observed", "kind": "activity_completed", "data": {}},
        ],
    }


def journal(scene_id: str = "scene_01") -> dict:
    """One valid host-journal snapshot whose clock remains independent."""
    return {
        "schema": "studium/experiment-journal/v1",
        "bundle_revision": "revision-a",
        "storage": "private-local",
        "experiments": [{
            "experiment_id": "threshold",
            "scene_id": scene_id,
            "events": [
                {"sequence": 1, "recorded_at": "2026-09-11T09:00:01Z", "input": {"kind": "predict", "experiment_id": "threshold", "prediction": "journal prediction", "justification": "journal reason", "confidence": 2, "authorship": "learner", "consent": True}},
                {"sequence": 2, "recorded_at": "2026-09-11T09:00:02Z", "input": {"kind": "begin", "experiment_id": "threshold"}},
                {"sequence": 3, "recorded_at": "2026-09-11T09:00:03Z", "input": {"kind": "observe", "experiment_id": "threshold", "text": "journal observation", "evidence_refs": ["private/result.json"], "authorship": "learner", "consent": True}},
                {"sequence": 4, "recorded_at": "2026-09-11T09:00:04Z", "input": {"kind": "conclude", "experiment_id": "threshold", "text": "journal conclusion", "confidence": 3, "authorship": "learner", "consent": True}},
            ],
        }],
    }


def write_json(path: Path, value: object) -> Path:
    """Write one synthetic source fixture."""
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def prepared_activity(value: dict) -> dict:
    """Validated parameter-comparison context matching ``value`` identities."""
    config = {
        "schema": "studium/activity-template-config/v1",
        "template_id": value["template_id"],
        "data_status": "synthetic teaching fixture",
        "scope": "A fixed synthetic input with one varied gain.",
        "prediction_prompt": "Predict the response.",
        "expected_source_inputs": ["A fixed public synthetic input"],
        "independent_checks": [{"id": "single_factor", "description": "Only gain changes."}],
        "source": {"id": "fixture", "title": "Synthetic fixture", "locator": "urn:studium:fixture", "source_kind": "synthetic_fixture", "statement": "Values are invented for teaching."},
        "parameter": {"id": "gain", "label": "Gain", "unit": "x", "min": 0.5, "max": 3.0, "step": 0.5, "baseline": 1.5, "variation": 2.0},
        "model": {"kind": "linear_gain", "fixed_input": 4.0, "input_label": "Input", "input_unit": "a.u.", "output_label": "Response", "output_unit": "a.u.", "equation": "response = gain x input"},
        "oracle": {"baseline_output": 6.0, "variation_output": 8.0, "delta": 2.0},
        "control": "Input remains fixed.",
    }
    return {
        "schema": "studium/prepared-activity/v1",
        "activity_id": value["activity_id"], "template_id": value["template_id"],
        "template_version": value["template_version"], "scene_id": value["scene_id"],
        "scene": {"title": "Compare gain", "objective_refs": []},
        "data_status": config["data_status"],
        "learning_goal": "Attribute a numerical change to one varied parameter within the limits of a controlled synthetic comparison.",
        "scope": config["scope"], "prediction_prompt": config["prediction_prompt"],
        "expected_source_inputs": config["expected_source_inputs"],
        "independent_checks": config["independent_checks"], "config": config,
    }


def test_default_export_redacts_text_and_keeps_timelines_separate(tmp_path) -> None:
    """A combined report omits private words and never merges independent clocks."""
    out = tmp_path / "report"
    export_learner_report(
        actions_path=write_json(tmp_path / "actions.json", activity()),
        journal_path=write_json(tmp_path / "journal.json", journal()),
        output_dir=out,
        include_original_text=False,
    )
    actions = json.loads((out / "sources/learner-actions.json").read_text())
    host = json.loads((out / "sources/experiment-journal.json").read_text())
    report = json.loads((out / "report.json").read_text())
    rendered = (out / "index.html").read_text()
    assert actions["events"][1]["data"]["text"] == "[redacted]"
    assert actions["events"][2]["data"]["text"] == "[redacted]"
    assert host["experiments"][0]["events"][0]["input"]["prediction"] == "[redacted]"
    assert host["experiments"][0]["events"][2]["input"]["evidence_refs"] == ["[redacted]"]
    assert report["timelines"] == ["browser_or_harness_reported_activity", "host_journal_snapshot"]
    assert report["chronology"] == "separate_not_merged"
    assert report["assistance_status"] == "recorded"
    assert "exact learner prediction" not in rendered
    assert "&lt;script&gt;" not in rendered
    assert (out / "course_provenance.myst.md").is_file()
    assert (out / "trace/exploration_tree.yaml").is_file()
    assert verify_learner_report(out)["ok"] is True


def test_explicit_text_export_preserves_exact_words_and_escapes_html(tmp_path) -> None:
    """The explicit choice preserves bytes in JSON while the browser view escapes markup."""
    out = tmp_path / "report"
    export_learner_report(
        actions_path=write_json(tmp_path / "actions.json", activity()),
        journal_path=None,
        output_dir=out,
        include_original_text=True,
    )
    actions = json.loads((out / "sources/learner-actions.json").read_text())
    rendered = (out / "index.html").read_text()
    assert actions["events"][1]["data"]["text"] == "  exact learner prediction\n"
    assert "<script>alert(1)</script>" not in rendered
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in rendered
    assert json.loads((out / "report.json").read_text())["privacy"]["original_text"] == "included_by_explicit_choice"


def test_prepared_activity_context_binds_identifiers_and_labels_actions(tmp_path) -> None:
    """Public prepared context makes controls interpretable without catalogue inference."""
    actions = activity()
    actions["events"].insert(5, {"sequence": 6, "recorded_at": "2026-09-11T10:00:05.5Z", "actor": "learner", "origin": "browser_observed", "kind": "parameter_changed", "data": {"parameter_id": "gain", "before": 1.5, "after": 2.0}})
    for sequence, row in enumerate(actions["events"], 1):
        row["sequence"] = sequence
    definition = prepared_activity(actions)
    actions["activity_sha256"] = activity_digest(definition)
    out = tmp_path / "report"
    export_learner_report(
        write_json(tmp_path / "actions.json", actions), out,
        activity_path=write_json(tmp_path / "activity.json", definition),
    )
    report = json.loads((out / "report.json").read_text())
    page = (out / "index.html").read_text()
    assert report["context_status"] == "available"
    assert report["activity_context"]["learning_goal"].startswith("Attribute a numerical change")
    assert "Gain: 1.5 x → 2.0 x" in page
    assert "Values are invented for teaching." in page
    assert "activity_definition" in (out / "astra.yaml").read_text()
    assert verify_learner_report(out)["ok"] is True


def test_prepared_activity_identity_mismatch_is_rejected(tmp_path) -> None:
    """A mutable catalogue default cannot be attached to a different activity run."""
    actions = activity()
    definition = prepared_activity(actions)
    actions["activity_sha256"] = activity_digest(definition)
    definition["scene_id"] = "another.scene:2"
    with pytest.raises(ReportError, match="identity"):
        export_learner_report(
            write_json(tmp_path / "actions.json", actions), tmp_path / "report",
            activity_path=write_json(tmp_path / "activity.json", definition),
        )


def test_prepared_activity_same_identity_but_modified_content_is_rejected(tmp_path) -> None:
    """Stable IDs cannot silently bind recorded actions to modified activity context."""
    actions = activity()
    definition = prepared_activity(actions)
    actions["activity_sha256"] = activity_digest(definition)
    definition["config"]["source"]["statement"] = "A different, still valid source statement."
    with pytest.raises(ReportError, match="content digest"):
        export_learner_report(
            write_json(tmp_path / "actions.json", actions), tmp_path / "report",
            activity_path=write_json(tmp_path / "activity.json", definition),
        )


def test_prepared_activity_requires_content_digest_on_actions(tmp_path) -> None:
    """A definition cannot interpret an older sidecar that lacks an exact binding."""
    actions = activity()
    with pytest.raises(ReportError, match="lack.*content digest"):
        export_learner_report(
            write_json(tmp_path / "actions.json", actions), tmp_path / "report",
            activity_path=write_json(tmp_path / "activity.json", prepared_activity(actions)),
        )


def test_missing_assistance_is_unknown_not_none(tmp_path) -> None:
    """An absent harness trace cannot establish that the learner received no help."""
    value = activity()
    value["events"] = [row for row in value["events"] if "assistance" not in row["kind"]]
    for sequence, row in enumerate(value["events"], 1):
        row["sequence"] = sequence
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", value), out)
    assert json.loads((out / "report.json").read_text())["assistance_status"] == "unknown"
    assert "does not establish that no help occurred" in (out / "course_provenance.myst.md").read_text()


def test_combined_sources_require_explicit_scene_membership(tmp_path) -> None:
    """A journal is not attached to an activity merely because both files exist."""
    with pytest.raises(ReportError, match="scene"):
        export_learner_report(
            actions_path=write_json(tmp_path / "actions.json", activity("activity_scene")),
            journal_path=write_json(tmp_path / "journal.json", journal("other_scene")),
            output_dir=tmp_path / "report",
        )


def test_rejects_invalid_journal_order_and_duplicate_activity_sequence(tmp_path) -> None:
    """The exporter refuses source corruption instead of repairing it."""
    bad_journal = journal()
    bad_journal["experiments"][0]["events"][1]["sequence"] = 1
    with pytest.raises(ReportError, match="journal"):
        export_learner_report(
            write_json(tmp_path / "actions.json", activity()), tmp_path / "bad-journal-report",
            journal_path=write_json(tmp_path / "journal.json", bad_journal),
        )
    bad_activity = activity()
    bad_activity["events"][1]["sequence"] = 1
    with pytest.raises(ReportError, match="activity"):
        export_learner_report(
            write_json(tmp_path / "bad-actions.json", bad_activity), tmp_path / "bad-actions-report"
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["experiments"][0]["events"][0]["input"].update(prediction="   "),
        lambda value: value["experiments"][0]["events"][2]["input"].update(evidence_refs=[""]),
        lambda value: value["experiments"][0]["events"][0].update(recorded_at="2026-09-11 09:00:01"),
        lambda value: value["experiments"][0]["events"][0]["input"].update(consent=1),
    ],
)
def test_journal_snapshot_matches_host_admission_boundaries(tmp_path, mutate) -> None:
    """Blank text, bad locators/times and non-boolean consent are refused."""
    value = journal()
    mutate(value)
    with pytest.raises(ReportError, match="journal"):
        export_learner_report(None, tmp_path / "report", journal_path=write_json(tmp_path / "journal.json", value))


def test_journal_can_be_exported_without_an_activity(tmp_path) -> None:
    """A selected journal snapshot remains useful without inventing activity context."""
    out = tmp_path / "report"
    export_learner_report(None, out, journal_path=write_json(tmp_path / "journal.json", journal()))
    report = json.loads((out / "report.json").read_text())
    assert report["activity"] is None and report["context_status"] == "unavailable"
    assert report["binding_assurance"] == "single_source_only"
    assert verify_learner_report(out)["ok"] is True


def test_hash_verification_detects_source_tampering(tmp_path) -> None:
    """The stored SHA-256 binds the machine-readable source selected for export."""
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", activity()), out)
    exported = out / "sources/learner-actions.json"
    exported.write_text(exported.read_text() + " ", encoding="utf-8")
    with pytest.raises(ReportError, match="hash"):
        verify_learner_report(out)


def test_verification_requires_exact_artifact_coverage(tmp_path) -> None:
    """Dropping a standard output from an otherwise valid manifest is detected."""
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", activity()), out)
    checks_path = out / "checks.json"
    checks = json.loads(checks_path.read_text())
    checks["artifacts"].pop("index.html")
    checks_path.write_text(
        json.dumps(checks, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ReportError, match="exact report artifacts"):
        verify_learner_report(out)


def test_verification_rederives_summary_after_coherent_rehash(tmp_path) -> None:
    """Rehashing a false report count cannot detach it from validated sources."""
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", activity()), out)
    report_path = out / "report.json"
    report = json.loads(report_path.read_text())
    report["counts"]["activity_events"] = 999
    report_path.write_text(
        json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    checks_path = out / "checks.json"
    checks = json.loads(checks_path.read_text())
    checks["artifacts"]["report.json"] = hashlib.sha256(report_path.read_bytes()).hexdigest()
    checks_path.write_text(
        json.dumps(checks, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ReportError, match="summary"):
        verify_learner_report(out)


def test_astra_uses_only_schema_fields_and_real_validator(tmp_path) -> None:
    """Learner actions remain a declared artifact and ASTRA validates unchanged."""
    out = tmp_path / "report"
    export_learner_report(write_json(tmp_path / "actions.json", activity()), out)
    astra = (out / "astra.yaml").read_text()
    assert "version: 0.0.14" in astra
    assert "learner_actions" in astra
    assert "learner_events:" not in astra
    verification = verify_learner_report(out)
    assert verification["astra_validator"] == "astra-tools"


def test_existing_observatory_serves_generated_report_as_real_mystra_html(tmp_path) -> None:
    """The generated ASTRA/ARA set opens through the existing MySTRA HTML route."""
    actions = activity()
    actions["events"].insert(4, {
        "sequence": 5, "recorded_at": "2026-09-11T10:00:04.5Z",
        "actor": "learner", "origin": "browser_observed", "kind": "parameter_changed",
        "data": {"parameter_id": "gain", "before": 1.5, "after": 2.0},
    })
    for sequence, row in enumerate(actions["events"], 1):
        row["sequence"] = sequence
    out = tmp_path / "learner-report"
    export_learner_report(write_json(tmp_path / "actions.json", actions), out)
    observatory = Path(__file__).resolve().parents[1] / "services/observatory"
    sys.path.insert(0, str(observatory))
    try:
        from fastapi.testclient import TestClient
        from observatory_app import create_app
        from observatory_config import ObservatoryConfig
        cfg = ObservatoryConfig(
            course_root=tmp_path, courses=(), eval_root=tmp_path / "missing-eval",
            validity_root=tmp_path / "missing-validity", harness_refresh=0,
        )
        response = TestClient(create_app(cfg)).get("/courses/learner-report/mystra")
    finally:
        sys.path.remove(str(observatory))
    assert response.status_code == 200
    assert "Learner activity technical report" in response.text
    assert "technical integrity statement" in response.text
    assert "Parameter Changed" in response.text
    assert "Activity sequence 5" in response.text
    assert "0</span><span class=\"label\">Scenes judged" in response.text
