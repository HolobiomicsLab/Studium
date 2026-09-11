#!/usr/bin/env python3
"""Export and verify a privacy-defaulted local Studium learner activity report.

The report combines selected records only when their public ``scene_id`` values
overlap. That overlap does not authenticate a learner, bundle or session, and the
activity and host-journal clocks remain separate. ASTRA describes the exported
artifacts; learner actions are never added as custom ASTRA fields.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import importlib.metadata as metadata
import json
import re
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError, field_validator, model_validator

from learner_trace import (
    AssistanceProvidedEvent,
    AssistanceRequestedEvent,
    LearnerActivityDocument,
    LearnerTextEvent,
    read_json_payload,
    read_trace_file,
)
from experience_templates import activity_digest, validate_prepared_activity

ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "services" / "planner"
THEME_PATH = ROOT / "ui" / "studium-theme.css"
if str(PLANNER) not in sys.path:
    sys.path.insert(0, str(PLANNER))

from agentic.decision import make_decision, make_insight  # noqa: E402
from provenance.astra_contract import ASTRA_SCHEMA_VERSION  # noqa: E402
from provenance.astra_emit import emit_astra, write_astra_yaml  # noqa: E402
from provenance.astra_validate import run_astra_validate  # noqa: E402
from provenance.exploration_trace import (  # noqa: E402
    NODE_ID_PATTERN,
    NODE_TYPES,
    REQUIRED_FIELDS_BY_TYPE,
    SUPPORT_LEVELS,
    TRACE_SCHEMA_VERSION,
    build_exploration_tree,
    write_exploration_trace,
)
from astra_render import render as render_mystra  # noqa: E402

REPORT_SCHEMA = "studium/learner-report/v1"
CHECKS_SCHEMA = "studium/learner-report-checks/v1"
JOURNAL_SCHEMA = "studium/experiment-journal/v1"
REDACTED = "[redacted]"
HASH_PATTERN = r"^[0-9a-f]{64}$"
TEXT_MAX = 12_000
JournalEvidenceRef = Annotated[str, Field(min_length=1, max_length=500)]


def _require_true_boolean(value: object) -> object:
    """Reject integers that Python and ``Literal[True]`` otherwise equate to true."""
    if type(value) is not bool or value is not True:
        raise ValueError("consent must be the boolean true")
    return value


StrictTrue = Annotated[Literal[True], BeforeValidator(_require_true_boolean)]


class ReportError(ValueError):
    """A selected source or generated report failed a required check."""


class StrictModel(BaseModel):
    """Base for report wire records that reject unrecognized fields and coercion."""

    model_config = ConfigDict(extra="forbid", strict=True)


class JournalInputBase(StrictModel):
    """Fields shared by experiment-journal inputs."""

    experiment_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")


class JournalPredictInput(JournalInputBase):
    """Learner prediction captured by the host journal."""

    kind: Literal["predict"]
    prediction: str = Field(min_length=1, max_length=TEXT_MAX)
    justification: str = Field(min_length=1, max_length=TEXT_MAX)
    confidence: int = Field(ge=0, le=4)
    authorship: Literal["learner"]
    consent: StrictTrue

    @field_validator("prediction", "justification")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        """Mirror the host's nonblank learner-text boundary without trimming."""
        if not value.strip():
            raise ValueError("journal learner text must not be blank")
        return value


class JournalBeginInput(JournalInputBase):
    """Host marker that an experiment began."""

    kind: Literal["begin"]


class JournalObserveInput(JournalInputBase):
    """Learner observation captured by the host journal."""

    kind: Literal["observe"]
    text: str = Field(min_length=1, max_length=TEXT_MAX)
    evidence_refs: list[JournalEvidenceRef] = Field(default_factory=list, max_length=30)
    authorship: Literal["learner"]
    consent: StrictTrue

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        """Mirror the host's nonblank learner-text boundary without trimming."""
        if not value.strip():
            raise ValueError("journal learner text must not be blank")
        return value


class JournalConcludeInput(JournalInputBase):
    """Learner conclusion captured by the host journal."""

    kind: Literal["conclude"]
    text: str = Field(min_length=1, max_length=TEXT_MAX)
    confidence: int = Field(ge=0, le=4)
    authorship: Literal["learner"]
    consent: StrictTrue

    @field_validator("text")
    @classmethod
    def reject_blank_text(cls, value: str) -> str:
        """Mirror the host's nonblank learner-text boundary without trimming."""
        if not value.strip():
            raise ValueError("journal learner text must not be blank")
        return value


JournalInput = Annotated[
    JournalPredictInput | JournalBeginInput | JournalObserveInput | JournalConcludeInput,
    Field(discriminator="kind"),
]


class JournalEvent(StrictModel):
    """One ordered host-journal event."""

    sequence: int = Field(gt=0)
    recorded_at: str
    input: JournalInput

    @field_validator("recorded_at")
    @classmethod
    def require_aware_time(cls, value: str) -> str:
        """Require the timezone-aware ISO timestamp enforced by the host schema."""
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", value):
            raise ValueError("journal recorded_at must be an RFC3339 UTC datetime")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("journal recorded_at must include a timezone")
        return value


class JournalExperiment(StrictModel):
    """One prediction-to-conclusion sequence in a host journal snapshot."""

    experiment_id: str
    scene_id: str = Field(min_length=1, max_length=240)
    events: list[JournalEvent] = Field(min_length=1, max_length=4)

    @model_validator(mode="after")
    def validate_sequence(self) -> "JournalExperiment":
        """Mirror the host's exact immutable event sequence checks."""
        order = ("predict", "begin", "observe", "conclude")
        for index, event in enumerate(self.events):
            if event.sequence != index + 1 or event.input.kind != order[index]:
                raise ValueError("journal events have invalid order or sequence")
            if event.input.experiment_id != self.experiment_id:
                raise ValueError("journal event experiment_id mismatch")
        return self


class ExperimentJournalDocument(StrictModel):
    """Validated snapshot of the existing host-owned journal document."""

    schema_id: Literal[JOURNAL_SCHEMA] = Field(alias="schema")
    bundle_revision: str
    storage: Literal["private-local", "ephemeral"]
    experiments: list[JournalExperiment] = Field(max_length=200)

    @model_validator(mode="after")
    def reject_duplicate_experiments(self) -> "ExperimentJournalDocument":
        """Reject duplicate experiment IDs exactly as the host reader does."""
        ids = [row.experiment_id for row in self.experiments]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate experiment in journal")
        return self


class SourceRecord(StrictModel):
    """Content digest and interpretation boundary for one sanitized source."""

    id: str
    path: str
    sha256: str = Field(pattern=HASH_PATTERN)
    timeline: Literal["browser_or_harness_reported_activity", "host_journal_snapshot", "not_a_timeline"]
    origin: str


class PrivacyRecord(StrictModel):
    """The explicit text-handling choice applied by this export."""

    original_text: Literal["excluded_by_default", "included_by_explicit_choice"]
    dedicated_identity_fields: Literal["not_collected"] = "not_collected"


class LearnerReportDocument(StrictModel):
    """Machine-readable summary derived only from selected sanitized records."""

    schema_id: Literal[REPORT_SCHEMA] = Field(alias="schema")
    generated_at: str
    privacy: PrivacyRecord
    activity: dict[str, str] | None
    activity_context: dict[str, Any] | None
    context_status: Literal["available", "unavailable"]
    sources: list[SourceRecord]
    timelines: list[Literal["browser_or_harness_reported_activity", "host_journal_snapshot"]]
    chronology: Literal["separate_not_merged"]
    binding_assurance: Literal["scene_identifier_overlap_only", "single_source_only"]
    assistance_status: Literal["recorded", "unknown"]
    technical_integrity: Literal["validated_at_export"]
    scientific_validation: Literal["not_performed"]
    learning_assessment: Literal["not_performed"]
    counts: dict[str, int]


class AstraCheck(StrictModel):
    """Recorded real-validator result for the generated ASTRA document."""

    validator: Literal["astra-tools"]
    astra_spec: Literal[ASTRA_SCHEMA_VERSION]
    evidence_resolution: Literal["skipped"]
    status: Literal["passed"]


class ReportChecks(StrictModel):
    """Integrity hashes for every generated artifact except this manifest itself."""

    schema_id: Literal[CHECKS_SCHEMA] = Field(alias="schema")
    generated_at: str
    astra: AstraCheck
    artifacts: dict[str, str]

    @field_validator("artifacts")
    @classmethod
    def validate_artifact_hashes(cls, value: dict[str, str]) -> dict[str, str]:
        """Accept bounded relative paths and lowercase SHA-256 digests only."""
        if not value or len(value) > 20:
            raise ValueError("checks must cover between 1 and 20 artifacts")
        for path, digest in value.items():
            if Path(path).is_absolute() or ".." in Path(path).parts:
                raise ValueError("checked artifact paths must stay relative")
            if not re.fullmatch(HASH_PATTERN, digest):
                raise ValueError("checked artifact hash must be SHA-256")
        return value


def _now() -> str:
    """Current UTC timestamp in the same explicit form as Studium records."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    """SHA-256 digest of a file's exact bytes."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_json(path: Path, value: object) -> None:
    """Write stable UTF-8 JSON for review and later hash verification."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def _read_journal(path: Path) -> ExperimentJournalDocument:
    """Read a host-journal snapshot with strict JSON and schema validation."""
    return ExperimentJournalDocument.model_validate(read_json_payload(path))


def _redact_activity(document: LearnerActivityDocument) -> dict[str, Any]:
    """Replace learner and assistance words while retaining semantic event fields."""
    value = document.model_dump(mode="json", by_alias=True)
    for event in value["events"]:
        if event["kind"] in {"learner_text_submitted", "assistance_requested", "assistance_provided"}:
            if event["data"].get("text") is not None:
                event["data"]["text"] = REDACTED
    return value


def _redact_journal(document: ExperimentJournalDocument) -> dict[str, Any]:
    """Replace all host-journal free text and locator strings."""
    value = document.model_dump(mode="json", by_alias=True)
    for experiment in value["experiments"]:
        for event in experiment["events"]:
            item = event["input"]
            for field in ("prediction", "justification", "text"):
                if field in item:
                    item[field] = REDACTED
            if "evidence_refs" in item:
                item["evidence_refs"] = [REDACTED] * len(item["evidence_refs"])
    return value


def _source_record(identifier: str, relative: str, timeline: str, origin: str, root: Path) -> dict:
    """Describe one sanitized source using only its report-relative path."""
    return {
        "id": identifier,
        "path": relative,
        "sha256": _sha256(root / relative),
        "timeline": timeline,
        "origin": origin,
    }


def _assistance_status(activity: LearnerActivityDocument | None) -> str:
    """Report only recorded assistance; absence remains unknown."""
    if activity and any(isinstance(row, (AssistanceRequestedEvent, AssistanceProvidedEvent)) for row in activity.events):
        return "recorded"
    return "unknown"


def _activity_context(activity_definition: dict | None) -> dict | None:
    """Select public context needed to interpret action identifiers."""
    if activity_definition is None:
        return None
    config = activity_definition["config"]
    choices = config.get("claims") or [
        {"id": node["id"], "label": node["id"]}
        for node in config.get("network", {}).get("nodes", [])
    ]
    parameter = config.get("parameter")
    return {
        "learning_goal": activity_definition["learning_goal"],
        "data_status": activity_definition["data_status"],
        "scope": activity_definition["scope"],
        "source": dict(config["source"]),
        "parameter": None if parameter is None else {
            key: parameter[key] for key in ("id", "label", "unit", "baseline", "variation")
            if key in parameter
        },
        "choices": choices,
        "control": config.get("control"),
        "independent_checks": activity_definition["independent_checks"],
    }


def _report_value(activity, journal, activity_definition, sources, include_original_text, generated_at) -> dict:
    """Build the machine-readable report summary without merging timelines."""
    timelines = [source["timeline"] for source in sources if source["timeline"] != "not_a_timeline"]
    return {
        "schema": REPORT_SCHEMA,
        "generated_at": generated_at,
        "privacy": {
            "original_text": "included_by_explicit_choice" if include_original_text else "excluded_by_default",
            "dedicated_identity_fields": "not_collected",
        },
        "activity": None if activity is None else {
            "activity_id": activity.activity_id,
            "template_id": activity.template_id,
            "template_version": activity.template_version,
            "scene_id": activity.scene_id,
            **({"activity_sha256": activity.activity_sha256} if activity.activity_sha256 else {}),
        },
        "activity_context": _activity_context(activity_definition),
        "context_status": "available" if activity_definition else "unavailable",
        "sources": sources,
        "timelines": timelines,
        "chronology": "separate_not_merged",
        "binding_assurance": "scene_identifier_overlap_only" if activity and journal else "single_source_only",
        "assistance_status": _assistance_status(activity),
        "technical_integrity": "validated_at_export",
        "scientific_validation": "not_performed",
        "learning_assessment": "not_performed",
        "counts": {"activity_events": len(activity.events) if activity else 0, "journal_experiments": len(journal.experiments) if journal else 0},
    }


def _privacy_decision(include_original_text: bool) -> dict:
    """ASTRA decision recording the explicit export privacy choice."""
    selected = "original_text_included" if include_original_text else "free_text_redacted"
    return make_decision(
        decision_id="privacy_export",
        label="Learner free-text export",
        rationale="Original learner and assistance words require an explicit local export choice.",
        options=[{"id": "free_text_redacted", "label": "Free text redacted"}, {"id": "original_text_included", "label": "Original text included explicitly"}],
        default=selected,
    )


def _binding_decision(has_both: bool) -> dict:
    """ASTRA decision declaring the limited source-binding assurance."""
    selected = "scene_overlap" if has_both else "single_source"
    return make_decision(
        decision_id="source_binding",
        label="Selected report sources",
        rationale="Scene overlap checks identifiers only; it does not authenticate learner, bundle or session identity, and clocks remain separate.",
        options=[{"id": "single_source", "label": "One selected source"}, {"id": "scene_overlap", "label": "Two sources with scene identifier overlap"}],
        default=selected,
    )


def _report_astra(report: LearnerReportDocument) -> dict:
    """Emit a strict ASTRA 0.0.14 envelope around sanitized report artifacts."""
    outputs = [{"id": source.id, "type": "data", "format": "json", "description": f"Sanitized selected record at {source.path}; SHA-256 {source.sha256}."} for source in report.sources]
    outputs += [
        {"id": "learner_report", "type": "data", "format": "json", "description": "report.json: technical summary; no learning assessment."},
        {"id": "ara_trace", "type": "data", "format": "yaml", "description": "trace/exploration_tree.yaml: source-separated export path."},
        {"id": "mystra_report", "type": "report", "format": "md", "description": "course_provenance.myst.md rendered by the shared MySTRA renderer."},
        {"id": "browser_report", "type": "report", "format": "html", "description": "index.html: escaped local technical report."},
        {"id": "report_checks", "type": "data", "format": "json", "description": "checks.json: hashes and ASTRA validator result."},
    ]
    findings = _report_findings(report)
    document = emit_astra(
        analysis_id="learner_activity_report",
        name="Learner activity technical report",
        decisions=[
            _privacy_decision(report.privacy.original_text == "included_by_explicit_choice"),
            _binding_decision(report.binding_assurance == "scene_identifier_overlap_only"),
        ],
        prior_insights=[], findings=findings, outputs=outputs,
        inputs=[{"id": source.id + "_input", "type": "data", "description": f"Selected sanitized source {source.path}."} for source in report.sources],
    )
    slug = "learner_activity_report"
    for root_output, output in zip(document["outputs"], outputs):
        root_output["id"] = f"{slug}_{output['id']}_result"
    document["description"] = "Local technical provenance report for selected learner activity records. It makes no scientific validation or learning assessment."
    return document


def _report_findings(report: LearnerReportDocument) -> list[dict]:
    """Create evidence-anchored technical findings without learner outcomes."""
    findings = []
    for source in report.sources:
        if source.id == "activity_definition":
            findings.append(make_insight(
                insight_id="validated_activity_definition",
                claim="The selected prepared activity definition passed its closed public-context checks and binds the action identifiers shown in this report.",
                created_at=report.generated_at, evidence=[{"artifact": source.id}], derived=True,
            ))
            continue
        count = report.counts["activity_events"] if source.id == "learner_actions" else report.counts["journal_experiments"]
        unit = "semantic event(s)" if source.id == "learner_actions" else "experiment sequence(s)"
        findings.append(make_insight(
            insight_id=f"validated_{source.id}",
            claim=f"The selected sanitized {source.timeline} record contains {count} validated {unit}. This is a technical integrity statement, not a learning outcome.",
            created_at=report.generated_at, evidence=[{"artifact": source.id}], derived=True,
        ))
    if report.assistance_status == "unknown":
        findings.append(make_insight(
            insight_id="assistance_coverage_unknown",
            claim="The selected records contain no assistance event; missing trace does not establish that no help occurred.",
            created_at=report.generated_at, evidence=[{"artifact": report.sources[0].id}], derived=True,
        ))
    return findings


def _report_trace(
    document: dict,
    report: LearnerReportDocument,
    activity: dict | None,
    journal: dict | None,
) -> dict:
    """Project sanitized source events into separate, evidence-backed ARA branches."""
    tree = build_exploration_tree(document)
    root = tree["nodes"][0]
    root["title"] = "Which selected records and privacy choice produced this technical learner report?"
    used = []

    def collect(nodes: list[dict]) -> None:
        for node in nodes:
            used.append(int(node["id"][1:]))
            collect(node.get("children") or [])

    collect(tree["nodes"])
    next_id = max(used) + 1

    def node_id() -> str:
        nonlocal next_id
        value = f"N{next_id:02d}"
        next_id += 1
        return value

    def title(value: str) -> str:
        """Keep source wording visible without letting it shape MyST or Mermaid."""
        compact = " ".join(value.split())
        return compact if len(compact) <= 500 else compact[:497] + "..."

    if activity is not None:
        branch = {
            "id": node_id(), "type": "question",
            "title": "Browser or harness reported activity (separate timeline)",
            "support_level": "explicit", "source_refs": ["sources/learner-actions.json"],
            "children": [],
        }
        for index, event in enumerate(activity["events"]):
            actor = f"{event['actor']} / {event['origin']}"
            label = event["kind"].replace("_", " ").title()
            detail = _event_detail(event, report.activity_context)
            reference = f"sources/learner-actions.json#/events/{index}"
            branch["children"].append({
                "id": node_id(), "type": "experiment",
                "title": title(
                    f"Activity sequence {event['sequence']} · {actor} · {label} · {detail}"
                ),
                "support_level": "explicit", "source_refs": [reference],
                "result": "The sanitized sidecar records this event; capture does not establish a learning outcome.",
                "evidence": [reference],
            })
        root["children"].append(branch)
    if journal is not None:
        branch = {
            "id": node_id(), "type": "question",
            "title": "Imported host journal snapshot (separate, unauthenticated timeline)",
            "support_level": "explicit", "source_refs": ["sources/experiment-journal.json"],
            "children": [],
        }
        for experiment_index, experiment in enumerate(journal["experiments"]):
            for event_index, event in enumerate(experiment["events"]):
                kind = event["input"]["kind"]
                role = "host marker" if kind == "begin" else "learner declaration"
                detail = _journal_event_detail(event["input"])
                reference = (
                    "sources/experiment-journal.json#/experiments/"
                    f"{experiment_index}/events/{event_index}"
                )
                branch["children"].append({
                    "id": node_id(), "type": "experiment",
                    "title": title(
                        f"Journal {experiment['experiment_id']} sequence {event['sequence']} · "
                        f"{role} · {kind.title()} · {detail}"
                    ),
                    "support_level": "explicit", "source_refs": [reference],
                    "result": "The sanitized host snapshot records this event; its presence does not authenticate a learner or session.",
                    "evidence": [reference],
                })
        root["children"].append(branch)
    if report.context_status == "available":
        reference = "sources/activity.json"
        root["children"].append({
            "id": node_id(), "type": "experiment",
            "title": "Validate the exact prepared activity context bound by content digest",
            "support_level": "explicit", "source_refs": [reference],
            "result": "The prepared activity passed its closed schema and exact sidecar digest binding.",
            "evidence": [reference],
        })
    return tree


def _journal_event_detail(value: dict) -> str:
    """Describe one sanitized journal input without implying an inferred action."""
    if value["kind"] == "predict":
        return f"prediction: {value['prediction']}; justification: {value['justification']}; confidence {value['confidence']}/4"
    if value["kind"] == "observe":
        return f"observation: {value['text']}; {len(value['evidence_refs'])} evidence reference(s)"
    if value["kind"] == "conclude":
        return f"conclusion: {value['text']}; confidence {value['confidence']}/4"
    return "experiment start recorded"


def _validate_ara(tree: dict) -> None:
    """Check the generated tree against Studium's vendored ARA 0.1.0 contract."""
    if tree.get("schema_version") != TRACE_SCHEMA_VERSION:
        raise ReportError("ARA trace schema version mismatch")
    stack = list(tree.get("nodes") or [])
    seen: set[str] = set()
    while stack:
        node = stack.pop()
        if node.get("id") in seen or not NODE_ID_PATTERN.match(str(node.get("id", ""))):
            raise ReportError("ARA trace has duplicate or invalid node id")
        seen.add(node["id"])
        if node.get("type") not in NODE_TYPES or node.get("support_level") not in SUPPORT_LEVELS:
            raise ReportError("ARA trace has invalid node type or support level")
        if node["support_level"] == "explicit" and not node.get("source_refs"):
            raise ReportError("ARA explicit node lacks source_refs")
        for required in REQUIRED_FIELDS_BY_TYPE[node["type"]]:
            if not node.get("from" if required == "from_" else required):
                raise ReportError(f"ARA {node['type']} node lacks {required}")
        stack.extend(node.get("children") or [])


def _event_detail(event: dict, context: dict | None) -> str:
    """Human-readable event detail using validated prepared-activity labels."""
    data = event["data"]
    if event["kind"] == "parameter_changed":
        parameter = (context or {}).get("parameter") or {}
        label = parameter.get("label") if parameter.get("id") == data["parameter_id"] else data["parameter_id"]
        unit = f" {parameter.get('unit')}" if parameter.get("unit") else ""
        return f"{label}: {data['before']}{unit} → {data['after']}{unit}"
    if event["kind"] == "learner_choice_selected":
        labels = {row["id"]: row.get("text", row.get("label", row["id"])) for row in (context or {}).get("choices", [])}
        return f"{data['choice_id']}: {labels.get(data['choice_id'], 'label unavailable')}"
    if event["kind"] == "learner_text_submitted":
        suffix = f"; confidence {data['confidence']}/4" if data.get("confidence") is not None else ""
        return f"{data['phase']}: {data['text']}{suffix}"
    if "text" in data:
        return str(data["text"])
    return "Recorded"


def _event_rows(activity: dict | None, context: dict | None) -> str:
    """Escaped table rows for the selected activity timeline."""
    if not activity:
        return '<tr><td colspan="5">No activity sidecar selected.</td></tr>'
    rows = []
    for event in activity["events"]:
        values = (event["sequence"], event["recorded_at"], event["actor"], event["kind"].replace("_", " ").title(), _event_detail(event, context))
        rows.append("<tr>" + "".join(f"<td>{html.escape(str(value))}</td>" for value in values) + "</tr>")
    return "\n".join(rows)


def _journal_rows(journal: dict | None) -> str:
    """Escaped table rows for the independent host-journal snapshot."""
    if not journal:
        return '<tr><td colspan="4">No host journal snapshot selected.</td></tr>'
    rows = []
    for experiment in journal["experiments"]:
        for event in experiment["events"]:
            values = (experiment["experiment_id"], event["sequence"], event["recorded_at"], json.dumps(event["input"], ensure_ascii=False, sort_keys=True))
            rows.append("<tr>" + "".join(f"<td>{html.escape(str(value))}</td>" for value in values) + "</tr>")
    return "\n".join(rows)


def _render_html_v1(report: LearnerReportDocument, activity: dict | None, journal: dict | None, myst: str) -> str:
    """Render the immutable pre-theme browser view for legacy verification."""
    assistance = "Recorded in the selected sidecar." if report.assistance_status == "recorded" else "Unknown: missing trace does not establish that no help occurred."
    context = report.activity_context
    context_html = _context_html(context)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Learner activity technical report</title><style>body{{font:16px system-ui;max-width:1100px;margin:auto;padding:2rem;color:#18212b}}table{{border-collapse:collapse;width:100%;display:block;overflow:auto}}th,td{{border:1px solid #ccd5df;padding:.55rem;text-align:left;vertical-align:top}}code,pre{{background:#f4f6f8;padding:.2rem;white-space:pre-wrap;overflow-wrap:anywhere}}.notice{{border-left:4px solid #596b82;padding:.8rem;background:#f4f6f8}}</style></head>
<body><h1>Learner activity technical report</h1><p class="notice">Technical integrity only. Scientific validation: not performed. Learning assessment: not performed. Zero learning judgments is the intended report scope.</p>
<p>Privacy: {html.escape(report.privacy.original_text)}. Assistance coverage: {html.escape(assistance)}</p>
<p>The activity and host-journal timelines are displayed separately. Shared scene identifiers show overlap only; they do not authenticate a learner, bundle or session.</p>
<p><a href="course_provenance.myst.md">MySTRA source</a> · <a href="astra.yaml">ASTRA</a> · <a href="trace/exploration_tree.yaml">ARA trace</a> · <a href="checks.json">integrity checks</a></p>
<h2>Activity context</h2>{context_html}
<h2>Browser or harness reported activity</h2><table><thead><tr><th>Sequence</th><th>Reported UTC time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead><tbody>{_event_rows(activity, context)}</tbody></table>
<h2>Host journal snapshot</h2><table><thead><tr><th>Experiment</th><th>Sequence</th><th>Host time</th><th>Input</th></tr></thead><tbody>{_journal_rows(journal)}</tbody></table>
<details><summary>Shared MySTRA source rendering</summary><pre>{html.escape(myst)}</pre></details></body></html>\n"""


def _shared_theme() -> str:
    """Read the canonical local theme for inlining in a portable export."""
    return THEME_PATH.read_text(encoding="utf-8").rstrip()


def _table_region(label: str, headings: tuple[str, ...], rows: str) -> str:
    """Wrap one wide table in a named keyboard-scrollable region."""
    cells = "".join(f"<th>{html.escape(heading)}</th>" for heading in headings)
    return (
        f'<div class="table-scroll" tabindex="0" role="region" aria-label="{html.escape(label)}">'
        f"<table><thead><tr>{cells}</tr></thead><tbody>{rows}</tbody></table></div>"
    )


def _render_html(report: LearnerReportDocument, activity: dict | None, journal: dict | None, myst: str) -> str:
    """Render the current themed, self-contained browser view."""
    assistance = "Recorded in the selected sidecar." if report.assistance_status == "recorded" else "Unknown: missing trace does not establish that no help occurred."
    activity_table = _table_region(
        "Activity events table",
        ("Sequence", "Reported UTC time", "Actor", "Action", "Detail"),
        _event_rows(activity, report.activity_context),
    )
    journal_table = _table_region(
        "Host journal events table",
        ("Experiment", "Sequence", "Host time", "Input"),
        _journal_rows(journal),
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Learner activity technical report</title>
<style id="report-layout">
html{{scroll-behavior:smooth}}.skip-link{{position:fixed;z-index:100;top:.5rem;left:.5rem;transform:translateY(-180%);padding:.65rem 1rem;background:#193039;color:white;border-radius:.25rem}}.skip-link:focus{{transform:translateY(0)}}.viewer-header>div:first-child{{max-width:76ch}}.viewer-header .viewer-summary{{padding:0;border:0;background:transparent}}.resource-links{{display:flex;gap:.5rem 1rem;flex-wrap:wrap}}.report-section{{margin:0 0 2rem}}.visually-hidden{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}@media(prefers-reduced-motion:reduce){{html{{scroll-behavior:auto}}}}@media print{{.skip-link{{display:none}}}}
</style>
<style id="studium-theme">
{_shared_theme()}
</style></head>
<body class="studium-viewer" data-viewer="report">
<a class="skip-link" href="#main">Skip to content</a>
<header class="viewer-header"><div><p class="viewer-kicker">Studium · local technical export</p><h1>Learner activity technical report</h1><p class="viewer-summary">A privacy-defaulted reading copy of selected learner activity and host-journal records. The two timelines remain separate.</p></div></header>
<main id="main">
<nav class="section-nav" aria-label="Report sections"><a href="#overview">Overview</a><a href="#context">Context</a><a href="#activity">Activity</a><a href="#journal">Host journal</a><a href="#source">MySTRA source</a></nav>
<section class="report-section card" id="overview"><h2>Overview</h2><p class="notice">Technical integrity only. Scientific validation: not performed. Learning assessment: not performed. Zero learning judgments is the intended report scope.</p>
<p class="privacy">Privacy: {html.escape(report.privacy.original_text)}. Assistance coverage: {html.escape(assistance)}</p>
<p>The activity and host-journal timelines are displayed separately. Shared scene identifiers show overlap only; they do not authenticate a learner, bundle or session.</p>
<p class="resource-links"><a href="course_provenance.myst.md">MySTRA source</a><a href="astra.yaml">ASTRA</a><a href="trace/exploration_tree.yaml">ARA trace</a><a href="checks.json">Integrity checks</a></p></section>
<section class="report-section card" id="context"><h2>Activity context</h2>{_context_html(report.activity_context)}</section>
<section class="report-section" id="activity"><h2>Browser or harness reported activity</h2>{activity_table}</section>
<section class="report-section" id="journal"><h2>Host journal snapshot</h2>{journal_table}</section>
<section class="report-section" id="source"><h2>Shared source rendering</h2><details><summary>MySTRA source</summary><pre>{html.escape(myst)}</pre></details></section>
</main></body></html>\n"""


def _context_html(context: dict | None) -> str:
    """Escaped public context for learning goal, evidence and controls."""
    if context is None:
        return '<p class="notice">Context unavailable: no prepared activity definition was selected. Identifiers are shown without inferred catalogue labels.</p>'
    source = context["source"]
    parameter = context.get("parameter")
    control = f"<p><strong>Control:</strong> {html.escape(context['control'])}</p>" if context.get("control") else ""
    parameter_line = ""
    if parameter:
        unit = f" {parameter.get('unit')}" if parameter.get("unit") else ""
        parameter_line = f"<p><strong>{html.escape(parameter['label'])}:</strong> baseline {html.escape(str(parameter['baseline']))}{html.escape(unit)}; checked variation {html.escape(str(parameter['variation']))}{html.escape(unit)}.</p>"
    return f"<p><strong>Learning goal:</strong> {html.escape(context['learning_goal'])}</p><p><strong>Data status:</strong> {html.escape(context['data_status'])}</p><p><strong>Source:</strong> {html.escape(source['title'])} — {html.escape(source['statement'])} <small>{html.escape(source['locator'])}</small></p>{parameter_line}{control}"


def _ensure_scene_overlap(activity: LearnerActivityDocument, journal: ExperimentJournalDocument) -> None:
    """Require public scene-id overlap without claiming an identity-level join."""
    scenes = {row.scene_id for row in journal.experiments}
    if activity.scene_id not in scenes:
        raise ReportError("activity scene is absent from the selected journal snapshot")


def _ensure_activity_binding(activity: LearnerActivityDocument, definition: dict) -> None:
    """Bind the sidecar to one exact prepared activity definition."""
    expected = {
        "activity_id": activity.activity_id,
        "template_id": activity.template_id,
        "template_version": activity.template_version,
        "scene_id": activity.scene_id,
    }
    if any(definition.get(field) != value for field, value in expected.items()):
        raise ReportError("prepared activity identity does not match the learner actions")
    if activity.activity_sha256 is None:
        raise ReportError("learner actions lack the prepared activity content digest")
    if activity.activity_sha256 != activity_digest(definition):
        raise ReportError("prepared activity content digest does not match the learner actions")


def _copy_values(activity, journal, activity_definition, include_original_text) -> tuple[dict | None, dict | None, dict | None]:
    """Create exact or redacted source copies according to the explicit choice."""
    activity_value = activity.model_dump(mode="json", by_alias=True) if activity and include_original_text else (_redact_activity(activity) if activity else None)
    journal_value = journal.model_dump(mode="json", by_alias=True) if journal and include_original_text else (_redact_journal(journal) if journal else None)
    return activity_value, journal_value, activity_definition


def _artifact_hashes(directory: Path) -> dict[str, str]:
    """Hash every review artifact except the non-self-hashing checks manifest."""
    names = ["report.json", "astra.yaml", "trace/exploration_tree.yaml", "course_provenance.myst.md", "index.html"]
    names += [str(path.relative_to(directory)) for path in sorted((directory / "sources").glob("*.json"))]
    return {name: _sha256(directory / name) for name in names}


def export_learner_report(
    actions_path: Path | None,
    output_dir: Path,
    *,
    journal_path: Path | None = None,
    activity_path: Path | None = None,
    include_original_text: bool = False,
) -> Path:
    """Export selected activity and/or journal records to a verified local directory."""
    if actions_path is None and journal_path is None:
        raise ReportError("select an activity sidecar, a journal snapshot, or both")
    try:
        activity = read_trace_file(Path(actions_path)) if actions_path else None
        journal = _read_journal(Path(journal_path)) if journal_path else None
        definition = validate_prepared_activity(read_json_payload(Path(activity_path))) if activity_path else None
    except (OSError, ValueError, ValidationError) as exc:
        label = "activity" if actions_path and not journal_path else "journal or activity"
        raise ReportError(f"invalid {label} source: {exc}") from exc
    if definition is not None and activity is None:
        raise ReportError("a prepared activity definition requires learner actions")
    if activity and definition:
        _ensure_activity_binding(activity, definition)
    if activity and journal:
        _ensure_scene_overlap(activity, journal)
    return _export_validated(activity, journal, definition, Path(output_dir), include_original_text)


def _export_validated(activity, journal, definition, output_dir: Path, include_original_text: bool) -> Path:
    """Build the report atomically after source validation and binding checks."""
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise ReportError(f"output directory already exists: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_root = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}.", dir=output_dir.parent))
    staging = temporary_root / output_dir.name
    staging.mkdir()
    try:
        _build_report(staging, activity, journal, definition, include_original_text)
        staging.replace(output_dir)
        temporary_root.rmdir()
    except Exception:
        shutil.rmtree(temporary_root, ignore_errors=True)
        raise
    return output_dir


def _build_report(directory: Path, activity, journal, definition, include_original_text: bool) -> None:
    """Write, validate and render every artifact inside a staging directory."""
    generated_at = _now()
    activity_value, journal_value, definition_value = _copy_values(activity, journal, definition, include_original_text)
    sources: list[dict] = []
    if activity_value is not None:
        _write_json(directory / "sources/learner-actions.json", activity_value)
        sources.append(_source_record("learner_actions", "sources/learner-actions.json", "browser_or_harness_reported_activity", "browser_observed_and_harness_declared", directory))
    if journal_value is not None:
        _write_json(directory / "sources/experiment-journal.json", journal_value)
        sources.append(_source_record("experiment_journal", "sources/experiment-journal.json", "host_journal_snapshot", "imported_snapshot_not_authenticated", directory))
    if definition_value is not None:
        _write_json(directory / "sources/activity.json", definition_value)
        sources.append(_source_record("activity_definition", "sources/activity.json", "not_a_timeline", "validated_public_prepared_activity", directory))
    report = LearnerReportDocument.model_validate(_report_value(activity, journal, definition, sources, include_original_text, generated_at))
    _write_json(directory / "report.json", report.model_dump(mode="json", by_alias=True))
    document = _report_astra(report)
    write_astra_yaml(document, str(directory))
    tree = _report_trace(document, report, activity_value, journal_value)
    _validate_ara(tree)
    write_exploration_trace(tree, str(directory))
    validation = run_astra_validate(directory)
    if not validation.ok:
        raise ReportError(f"generated ASTRA failed astra-tools validation: {validation.output.strip()}")
    myst = render_mystra(directory)
    (directory / "course_provenance.myst.md").write_text(myst, encoding="utf-8")
    (directory / "index.html").write_text(_render_html(report, activity_value, journal_value, myst), encoding="utf-8")
    checks = {"schema": CHECKS_SCHEMA, "generated_at": generated_at, "astra": {"validator": "astra-tools", "astra_spec": ASTRA_SCHEMA_VERSION, "evidence_resolution": "skipped", "status": "passed"}, "artifacts": _artifact_hashes(directory)}
    _write_json(directory / "checks.json", ReportChecks.model_validate(checks).model_dump(mode="json", by_alias=True))


def _checked_path(directory: Path, relative: str) -> Path:
    """Resolve a manifest entry while keeping it inside the report directory."""
    candidate = directory / relative
    cursor = candidate
    while cursor != directory:
        if cursor.is_symlink():
            raise ReportError("checked artifact path contains a symbolic link")
        cursor = cursor.parent
    target = candidate.resolve()
    if directory != target and directory not in target.parents:
        raise ReportError("checked artifact escapes the report directory")
    return target


def verify_learner_report(directory: Path) -> dict[str, Any]:
    """Recheck hashes, source schemas, ARA, ASTRA, MySTRA and browser rendering."""
    directory = Path(directory).resolve()
    try:
        checks = ReportChecks.model_validate(read_json_payload(directory / "checks.json"))
        report = LearnerReportDocument.model_validate(read_json_payload(directory / "report.json"))
        for relative, expected in checks.artifacts.items():
            if _sha256(_checked_path(directory, relative)) != expected:
                raise ReportError(f"artifact hash mismatch: {relative}")
        activity, journal, definition, activity_value, journal_value = _verify_sources(directory, report)
        expected_report = LearnerReportDocument.model_validate(_report_value(
            activity, journal, definition, [row.model_dump(mode="json") for row in report.sources],
            report.privacy.original_text == "included_by_explicit_choice", report.generated_at,
        ))
        if expected_report != report:
            raise ReportError("report summary does not match its selected sources")
        expected_artifacts = set(_artifact_hashes(directory))
        if set(checks.artifacts) != expected_artifacts:
            raise ReportError("checks manifest does not cover the exact report artifacts")
        tree = __import__("yaml").safe_load((directory / "trace/exploration_tree.yaml").read_text(encoding="utf-8"))
        _validate_ara(tree)
        expected_astra = _report_astra(report)
        actual_astra = __import__("yaml").safe_load((directory / "astra.yaml").read_text(encoding="utf-8"))
        if actual_astra != expected_astra:
            raise ReportError("ASTRA document does not match the selected report sources")
        if tree != _report_trace(expected_astra, report, activity_value, journal_value):
            raise ReportError("ARA trace does not match the selected report sources")
        validation = run_astra_validate(directory)
        if not validation.ok:
            raise ReportError(f"ASTRA validation failed: {validation.output.strip()}")
        myst = render_mystra(directory)
        if myst != (directory / "course_provenance.myst.md").read_text(encoding="utf-8"):
            raise ReportError("MySTRA rendering is stale")
        actual_html = (directory / "index.html").read_text(encoding="utf-8")
        supported_html = {
            _render_html(report, activity_value, journal_value, myst),
            _render_html_v1(report, activity_value, journal_value, myst),
        }
        if actual_html not in supported_html:
            raise ReportError("browser rendering is stale")
        return {"ok": True, "astra_validator": "astra-tools", "artifacts": len(checks.artifacts)}
    except ReportError:
        raise
    except (OSError, ValueError, ValidationError) as exc:
        raise ReportError(f"invalid learner report: {exc}") from exc


def _verify_sources(directory: Path, report: LearnerReportDocument) -> tuple[Any, Any, Any, Any, Any]:
    """Revalidate sanitized sources and their digests from report.json."""
    if (directory / "sources").is_symlink():
        raise ReportError("sources directory must not be a symbolic link")
    allowed = {
        "learner_actions": ("sources/learner-actions.json", "browser_or_harness_reported_activity", "browser_observed_and_harness_declared"),
        "experiment_journal": ("sources/experiment-journal.json", "host_journal_snapshot", "imported_snapshot_not_authenticated"),
        "activity_definition": ("sources/activity.json", "not_a_timeline", "validated_public_prepared_activity"),
    }
    ids = [source.id for source in report.sources]
    if len(ids) != len(set(ids)) or any(identifier not in allowed for identifier in ids):
        raise ReportError("report has duplicate or unknown source IDs")
    activity_value = journal_value = definition = None
    activity = journal = None
    for source in report.sources:
        expected_path, expected_timeline, expected_origin = allowed[source.id]
        if (source.path, source.timeline, source.origin) != (expected_path, expected_timeline, expected_origin):
            raise ReportError(f"source metadata mismatch: {source.id}")
        path = _checked_path(directory, source.path)
        if _sha256(path) != source.sha256:
            raise ReportError(f"source hash mismatch: {source.path}")
        value = read_json_payload(path)
        if source.id == "learner_actions":
            activity = LearnerActivityDocument.model_validate(value)
            activity_value = activity.model_dump(mode="json", by_alias=True)
        elif source.id == "experiment_journal":
            journal = ExperimentJournalDocument.model_validate(value)
            journal_value = journal.model_dump(mode="json", by_alias=True)
        elif source.id == "activity_definition":
            definition = validate_prepared_activity(value)
    if activity is None and journal is None:
        raise ReportError("report contains no activity actions or journal snapshot")
    if definition is not None:
        if activity is None:
            raise ReportError("activity definition has no learner actions")
        _ensure_activity_binding(activity, definition)
    if activity and journal:
        _ensure_scene_overlap(activity, journal)
    expected_sources = []
    for identifier in ("learner_actions", "experiment_journal", "activity_definition"):
        if identifier in ids:
            relative, timeline, origin = allowed[identifier]
            expected_sources.append(SourceRecord.model_validate(_source_record(identifier, relative, timeline, origin, directory)))
    if expected_sources != report.sources:
        raise ReportError("report source hashes or ordering do not match selected files")
    source_files = {str(path.relative_to(directory)) for path in (directory / "sources").glob("*.json")}
    if source_files != {row.path for row in report.sources}:
        raise ReportError("sources directory contains missing or unreported JSON files")
    return activity, journal, definition, activity_value, journal_value


def _version(package: str) -> str:
    """Installed package version for concise CLI evidence."""
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return "missing"


def main(argv: list[str] | None = None) -> int:
    """Export or verify a local learner report."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="export selected local records")
    export.add_argument("output", type=Path)
    export.add_argument("--actions", type=Path)
    export.add_argument("--journal", type=Path)
    export.add_argument("--activity", type=Path)
    export.add_argument("--include-original-text", action="store_true")
    verify = commands.add_parser("verify", help="verify an exported report")
    verify.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "export":
            path = export_learner_report(args.actions, args.output, journal_path=args.journal, activity_path=args.activity, include_original_text=args.include_original_text)
            print(path)
        else:
            result = verify_learner_report(args.directory)
            print(json.dumps(result, sort_keys=True))
        print(f"astra-spec {_version('astra-spec')} / astra-tools {_version('astra-tools')}")
        return 0
    except (OSError, ValueError, ValidationError) as exc:
        print(f"learner report: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
