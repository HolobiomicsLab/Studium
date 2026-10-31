#!/usr/bin/env python3
"""Persist and enforce local review of an exact source-backed LessonPlan revision."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Protocol
from urllib.parse import unquote, urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from experience_exploration import Experiment, verify_exploration
from experience_review import refresh_experience_provenance, validate_review_values


SCHEMA_VERSION = "1.0"
APPROVAL_FILE = "plan-approval.json"
SYNTHESIS_FILE = "synthesis.json"
ATTEMPTS_FILE = "synthesis-attempts.jsonl"
SUPPORTING_INPUTS = ("evidence.json", "source_links.json", "viewers.json")
IMPORTED_FILES = ("plan.json", *SUPPORTING_INPUTS, "review.md")
EXPLORATION_SUMMARIES_FILE = "exploration-summaries.json"


class ApprovalError(ValueError):
    """The reviewed package cannot safely proceed to synthesis."""


class Synthesizer(Protocol):
    """Existing scene-synthesis boundary used by the reviewed workflow."""

    def synthesize_lesson(self, lesson_plan: dict, options: dict) -> dict:
        """Synthesize one lesson plan and return the service result."""


class ApprovalReceipt(BaseModel):
    """Integrity receipt for one locally reviewed plan and its supporting inputs."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    receipt_type: Literal["studium-reviewed-plan-approval"]
    authority: Literal["local-teacher-workspace"]
    identity_assurance: Literal["operator-declared"]
    approved_by: str = Field(min_length=3)
    approved_at: str
    plan_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    supporting_input_hashes: dict[str, str]
    supporting_inputs_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    student_release_approved: Literal[False] = False
    receipt_hash: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("approved_at")
    @classmethod
    def require_timezone(cls, value: str) -> str:
        """Require an ISO timestamp whose UTC offset is explicit."""
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("approved_at must include a timezone")
        return value


class SynthesisRecord(BaseModel):
    """Binding between an approval receipt and one generated local artifact."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    status: Literal["succeeded"]
    synthesized_at: str
    input_receipt_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    reviewed_plan_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    artifact_uri: str
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    generator_result: dict[str, Any]
    checks: list[dict[str, Any]]
    generated_content_approved: Literal[False] = False
    student_release_approved: Literal[False] = False


@dataclass(frozen=True)
class ReviewSnapshot:
    """The exact JSON values validated and hashed together."""

    plan: dict
    supporting_inputs: dict[str, Any]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApprovalError(f"cannot read {path.name}: {exc}") from exc


def _input_hashes(snapshot: ReviewSnapshot) -> dict[str, str]:
    return {
        name: _sha256(_canonical_bytes(value))
        for name, value in snapshot.supporting_inputs.items()
    }


def _write_json(path: Path, value: Any) -> None:
    payload = json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as stream:
        stream.write(payload)
        temporary = Path(stream.name)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _receipt_hash(value: dict[str, Any]) -> str:
    unsigned = {key: item for key, item in value.items() if key != "receipt_hash"}
    return _sha256(_canonical_bytes(unsigned))


def _review_snapshot(directory: Path) -> ReviewSnapshot:
    supporting = {name: _load_json(directory / name) for name in SUPPORTING_INPUTS}
    summaries = directory / EXPLORATION_SUMMARIES_FILE
    if summaries.exists():
        supporting[EXPLORATION_SUMMARIES_FILE] = _load_json(summaries)
    snapshot = ReviewSnapshot(
        plan=_load_json(directory / "plan.json"),
        supporting_inputs=supporting,
    )
    try:
        validate_review_values(
            snapshot.plan,
            snapshot.supporting_inputs["evidence.json"],
            snapshot.supporting_inputs["source_links.json"],
            snapshot.supporting_inputs["viewers.json"],
        )
    except (OSError, ValueError, KeyError, ValidationError) as exc:
        raise ApprovalError(f"invalid reviewed package: {exc}") from exc
    return snapshot


def _archive_synthesis(directory: Path) -> None:
    current = directory / SYNTHESIS_FILE
    if not current.exists():
        return
    history = directory / "synthesis-history"
    history.mkdir(exist_ok=True)
    archived = history / f"synthesis-{_now().replace(':', '')}-{_sha256(current.read_bytes())[:12]}.json"
    current.replace(archived)


def _exploration_summary(receipt: Path) -> dict[str, Any]:
    report = verify_exploration(receipt)
    record = Experiment.model_validate(_load_json(receipt / "experiment.json"))
    manifest = _load_json(receipt / "receipt.json")
    materials = [
        {
            "path": material.path,
            "role": material.role,
            "sha256": manifest["files"][material.path]["sha256"],
        }
        for material in record.files
    ]
    actions = [
        {
            "status": action.status,
            "source_ids": action.source_ids,
            "artifact_refs": action.evidence,
            "environment_ref": action.environment,
            "checks": [check.model_dump(mode="json") for check in action.checks],
        }
        for action in record.actions
    ]
    return {
        "id": _sha256((receipt / "receipt.json").read_bytes()),
        "scene_id": report["scene_id"],
        "integrity": report["integrity"],
        "execution": report["execution"],
        "sources": [source.model_dump(mode="json") | {"snapshot": source.snapshot}
                    for source in record.sources],
        "materials": materials,
        "actions": actions,
        "structured_learner_fields_excluded": True,
        "receipt_copy": "not copied; retain the independently portable receipt separately",
    }


def attach_exploration(directory: Path, receipt: Path) -> dict[str, Any]:
    """Attach a verified, non-private exploration summary to one reviewed scene."""
    directory = directory.resolve()
    snapshot = _review_snapshot(directory)
    try:
        summary = _exploration_summary(receipt.resolve())
    except (OSError, ValueError, ValidationError) as exc:
        raise ApprovalError(f"invalid exploration receipt: {exc}") from exc
    scene_ids = {row["id"] for row in snapshot.plan["scene_outlines"]}
    if summary["scene_id"] not in scene_ids:
        raise ApprovalError("exploration receipt scene is absent from the reviewed plan")
    summaries_path = directory / EXPLORATION_SUMMARIES_FILE
    current = _load_json(summaries_path) if summaries_path.exists() else {
        "schema_version": SCHEMA_VERSION, "explorations": []
    }
    if set(current) != {"schema_version", "explorations"}:
        raise ApprovalError("invalid exploration summary index")
    if any(row.get("id") == summary["id"] for row in current["explorations"]):
        raise ApprovalError("exploration receipt is already attached")
    current["explorations"].append(summary)
    _archive_synthesis(directory)
    _write_json(summaries_path, current)
    refresh_experience_provenance(directory)
    return summary


def import_checked_review(source: Path, workspace: Path) -> Path:
    """Copy a checked source-backed draft into a new local teacher workspace."""
    source = source.resolve()
    workspace = workspace.resolve()
    _review_snapshot(source)
    if workspace.exists():
        raise ApprovalError(f"teacher workspace already exists: {workspace}")
    workspace.mkdir(parents=True)
    try:
        for name in IMPORTED_FILES:
            shutil.copy2(source / name, workspace / name)
        refresh_experience_provenance(workspace)
    except Exception:
        shutil.rmtree(workspace)
        raise
    return workspace


def approve_plan(
    directory: Path, *, teacher_identity: str, approved_at: str | None = None
) -> ApprovalReceipt:
    """Approve the exact canonical plan and support inputs in a local workspace."""
    directory = directory.resolve()
    snapshot = _review_snapshot(directory)
    input_hashes = _input_hashes(snapshot)
    unsigned = {
        "schema_version": SCHEMA_VERSION,
        "receipt_type": "studium-reviewed-plan-approval",
        "authority": "local-teacher-workspace",
        "identity_assurance": "operator-declared",
        "approved_by": teacher_identity,
        "approved_at": approved_at or _now(),
        "plan_hash": _sha256(_canonical_bytes(snapshot.plan)),
        "supporting_input_hashes": input_hashes,
        "supporting_inputs_hash": _sha256(_canonical_bytes(input_hashes)),
        "student_release_approved": False,
    }
    try:
        receipt = ApprovalReceipt.model_validate(
            {**unsigned, "receipt_hash": _receipt_hash(unsigned)}
        )
    except ValidationError as exc:
        raise ApprovalError(f"invalid approval declaration: {exc}") from exc
    current_synthesis = directory / SYNTHESIS_FILE
    if current_synthesis.exists():
        current = _load_json(current_synthesis)
        if current.get("input_receipt_hash") != receipt.receipt_hash:
            _archive_synthesis(directory)
    _write_json(directory / APPROVAL_FILE, receipt.model_dump(mode="json"))
    refresh_experience_provenance(directory, approval=receipt.model_dump(mode="json"))
    return receipt


def _verified_approval(directory: Path) -> tuple[ApprovalReceipt, ReviewSnapshot]:
    """Capture and verify one immutable-in-memory package snapshot."""
    directory = directory.resolve()
    snapshot = _review_snapshot(directory)
    raw = _load_json(directory / APPROVAL_FILE)
    try:
        receipt = ApprovalReceipt.model_validate(raw)
    except ValidationError as exc:
        raise ApprovalError(f"invalid approval receipt: {exc}") from exc
    if receipt.receipt_hash != _receipt_hash(raw):
        raise ApprovalError("approval receipt was edited after it was issued")
    if receipt.plan_hash != _sha256(_canonical_bytes(snapshot.plan)):
        raise ApprovalError("plan revision changed after approval")
    current_inputs = _input_hashes(snapshot)
    if receipt.supporting_input_hashes != current_inputs:
        raise ApprovalError("supporting inputs changed after approval")
    if receipt.supporting_inputs_hash != _sha256(_canonical_bytes(current_inputs)):
        raise ApprovalError("supporting-input aggregate does not match the receipt")
    return receipt, snapshot


def verify_approval(directory: Path) -> ApprovalReceipt:
    """Reload and verify the receipt before any generator can be called."""
    return _verified_approval(directory)[0]


def verify_synthesis(directory: Path) -> SynthesisRecord:
    """Reload and verify the current artifact against the current approval receipt."""
    receipt, _ = _verified_approval(directory.resolve())
    try:
        record = SynthesisRecord.model_validate(_load_json(directory / SYNTHESIS_FILE))
    except ValidationError as exc:
        raise ApprovalError(f"invalid synthesis record: {exc}") from exc
    if record.input_receipt_hash != receipt.receipt_hash:
        raise ApprovalError("synthesis record belongs to a different approval receipt")
    if record.reviewed_plan_hash != receipt.plan_hash:
        raise ApprovalError("synthesis record belongs to a different plan revision")
    if _sha256(_artifact_path(record.artifact_uri).read_bytes()) != record.artifact_sha256:
        raise ApprovalError("synthesized artifact changed after it was recorded")
    return record


def verify_workspace(directory: Path) -> ApprovalReceipt:
    """Verify persisted state and refresh MySTRA from the current valid records."""
    receipt = verify_approval(directory)
    synthesis_path = directory / SYNTHESIS_FILE
    synthesis = verify_synthesis(directory).model_dump(mode="json") if synthesis_path.exists() else None
    refresh_experience_provenance(
        directory, approval=receipt.model_dump(mode="json"), synthesis=synthesis
    )
    return receipt


def _artifact_path(uri: str) -> Path:
    parsed = urlparse(uri)
    if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
        raise ApprovalError("synthesis must return a local file URI for artifact binding")
    path = Path(unquote(parsed.path))
    if not path.is_file():
        raise ApprovalError(f"synthesized artifact is missing: {path}")
    return path


def _record_failed_attempt(
    directory: Path, receipt: ApprovalReceipt, exc: Exception, result: Any = None
) -> dict:
    attempt = {
        "schema_version": SCHEMA_VERSION,
        "status": "failed",
        "attempted_at": _now(),
        "input_receipt_hash": receipt.receipt_hash,
        "error_type": type(exc).__name__,
        "error": str(exc),
        "generated_content_approved": False,
        "student_release_approved": False,
    }
    if isinstance(result, dict) and isinstance(result.get("bundle_uri"), str):
        attempt["unverified_artifact_uri"] = result["bundle_uri"]
        attempt["artifact_status"] = "unverified"
        try:
            attempt["unverified_artifact_sha256"] = _sha256(
                _artifact_path(result["bundle_uri"]).read_bytes()
            )
        except ApprovalError:
            pass
    with (directory / ATTEMPTS_FILE).open("a", encoding="utf-8") as stream:
        stream.write(_canonical_bytes(attempt).decode("utf-8") + "\n")
    return attempt


def _synthesis_record(receipt: ApprovalReceipt, result: dict) -> SynthesisRecord:
    uri = result.get("bundle_uri")
    if not isinstance(uri, str):
        raise ApprovalError("generator result has no bundle_uri")
    artifact_hash = _sha256(_artifact_path(uri).read_bytes())
    checks = [
        {"check": "approval_receipt_integrity", "passed": True},
        {"check": "reviewed_plan_hash_match", "passed": True},
        {"check": "supporting_input_hashes_match", "passed": True},
        {"check": "artifact_sha256_recorded", "passed": True},
    ]
    return SynthesisRecord(
        status="succeeded",
        synthesized_at=_now(),
        input_receipt_hash=receipt.receipt_hash,
        reviewed_plan_hash=receipt.plan_hash,
        artifact_uri=uri,
        artifact_sha256=artifact_hash,
        generator_result=result,
        checks=checks,
    )


def synthesize_approved_plan(
    directory: Path, orchestrator: Synthesizer, *, options: dict | None = None
) -> SynthesisRecord:
    """Verify the exact reviewed revision, then call the existing orchestrator once."""
    directory = directory.resolve()
    receipt, snapshot = _verified_approval(directory)
    result: Any = None
    try:
        result = orchestrator.synthesize_lesson(snapshot.plan, options or {})
        if _sha256(_canonical_bytes(snapshot.plan)) != receipt.plan_hash:
            raise ApprovalError("orchestrator mutated the reviewed plan during synthesis")
        current_receipt, _ = _verified_approval(directory)
        if current_receipt.receipt_hash != receipt.receipt_hash:
            raise ApprovalError("approval changed while synthesis was running")
        record = _synthesis_record(receipt, result)
    except Exception as exc:
        attempt = _record_failed_attempt(directory, receipt, exc, result)
        approval = None
        try:
            current_receipt, _ = _verified_approval(directory)
            if current_receipt.receipt_hash == receipt.receipt_hash:
                approval = receipt.model_dump(mode="json")
        except ApprovalError:
            pass
        refresh_experience_provenance(
            directory, approval=approval, failure=attempt
        )
        raise ApprovalError(f"synthesis failed and may be retried: {exc}") from exc
    _write_json(directory / SYNTHESIS_FILE, record.model_dump(mode="json"))
    refresh_experience_provenance(
        directory,
        approval=receipt.model_dump(mode="json"),
        synthesis=record.model_dump(mode="json"),
    )
    return record


def _load_orchestrator(reference: str) -> Synthesizer:
    module_name, separator, attribute = reference.partition(":")
    if not separator:
        raise ApprovalError("orchestrator must use MODULE:ATTRIBUTE syntax")
    candidate = getattr(importlib.import_module(module_name), attribute)
    if not hasattr(candidate, "synthesize_lesson") and callable(candidate):
        candidate = candidate()
    if not hasattr(candidate, "synthesize_lesson"):
        raise ApprovalError("orchestrator attribute has no synthesize_lesson method")
    return candidate


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    imported = commands.add_parser("import", help="create a local review workspace")
    imported.add_argument("checked_review", type=Path)
    imported.add_argument("workspace", type=Path)
    approve = commands.add_parser("approve", help="approve the current exact revision")
    approve.add_argument("workspace", type=Path)
    approve.add_argument("--teacher", required=True)
    verify = commands.add_parser("verify", help="verify the current approval receipt")
    verify.add_argument("workspace", type=Path)
    attach = commands.add_parser(
        "attach-exploration", help="attach a verified technical summary"
    )
    attach.add_argument("workspace", type=Path)
    attach.add_argument("receipt", type=Path)
    synthesize = commands.add_parser("synthesize", help="run a configured local orchestrator")
    synthesize.add_argument("workspace", type=Path)
    synthesize.add_argument("--orchestrator", required=True, metavar="MODULE:ATTRIBUTE")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the local reviewed-synthesis CLI."""
    args = _parser().parse_args(argv)
    try:
        if args.command == "import":
            result: Any = import_checked_review(args.checked_review, args.workspace)
        elif args.command == "approve":
            result = approve_plan(args.workspace, teacher_identity=args.teacher).receipt_hash
        elif args.command == "verify":
            result = verify_workspace(args.workspace).receipt_hash
        elif args.command == "attach-exploration":
            result = attach_exploration(args.workspace, args.receipt)["id"]
        else:
            result = synthesize_approved_plan(
                args.workspace, _load_orchestrator(args.orchestrator)
            ).artifact_uri
        print(result)
        return 0
    except (ApprovalError, OSError, ImportError, AttributeError) as exc:
        print(f"experience approval: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
