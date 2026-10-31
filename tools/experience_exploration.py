#!/usr/bin/env python3
"""Capture a local harness exploration for review; never execute or submit it.

The harness owns retrieval, provisioning, execution and human interaction. This
tool binds its explicit record and named files to a captured public scene. Hashes
detect changes relative to that snapshot, not fabricated science or execution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt

from exploration_public_context import validate_public_fields

Text = Annotated[str, Field(min_length=1)]
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024


class RecordModel(BaseModel):
    """Reject extra fields rather than accepting approval or grading claims."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Source(RecordModel):
    """An explicitly captured source, not a trusted domain allowlist."""
    id: Text
    kind: Literal["paper", "software_docs", "skill", "capsule", "dataset"]
    locator: Text
    title: Text
    retrieved_at: AwareDatetime | date
    snapshot: Text
    selection_reason: Text
    version: str | None = None


class Material(RecordModel):
    """A named file within the exploration workspace."""
    path: Text
    role: Literal["source", "skill", "input", "code", "output", "environment", "log"]


class Check(RecordModel):
    """An operator-reported check, not an independently rerun assertion."""
    name: Text
    passed: Annotated[bool, Field(strict=True)]


class Action(RecordModel):
    """Execution claims remain explicit and internally consistent."""
    status: Literal["not_run", "failed", "completed"]
    command: list[Text] = Field(min_length=1)
    source_ids: list[Text] = Field(min_length=1)
    evidence: list[Text] = Field(default_factory=list)
    checks: list[Check] = Field(default_factory=list)
    environment: str | None = None


class Observation(RecordModel):
    """Optional learner-owned text, recorded only at their request."""
    author: Literal["learner"]
    text: Text
    confidence: Annotated[StrictInt, Field(ge=0, le=4)] | None = None


class Experiment(RecordModel):
    """A review record separate from every Studium submission protocol."""
    format: Literal["studium/exploration/v1"]
    session_id: Text
    scene_id: Text
    context_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    question: Text
    hypothesis: Text
    sources: list[Source] = Field(min_length=1)
    files: list[Material] = Field(min_length=1)
    actions: list[Action] = Field(default_factory=list)
    learner_observation: Observation | None = None


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def _hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _read_json(path: Path) -> dict:
    value = json.loads(_read_material(path.parent, path.name), object_pairs_hook=_unique_keys,
                       parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path.name}")
    return value


def _unique_keys(pairs: list[tuple]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON key")
        value[key] = item
    return value


def _context(path: Path) -> dict:
    value = _read_json(path)
    validate_public_fields(value)
    if value.get("schema") != "studium/operator-context/v1":
        raise ValueError("Expected the public operator context")
    scene = value.get("scene")
    if not isinstance(scene, dict) or not isinstance(scene.get("id"), str) or not scene["id"].strip():
        raise ValueError("Missing public scene id")
    if not isinstance(value.get("session_id"), str) or not value["session_id"].strip():
        raise ValueError("Missing public session id")
    return value


def _read_material(root: Path, relative: str) -> bytes:
    if root.is_symlink():
        raise ValueError("Workspace and receipt directories cannot be symlinks")
    path = PurePosixPath(relative)
    forbidden = {"secrets", "credentials", "node_modules", ".git", ".ssh", ".venv"}
    if path.is_absolute() or "\\" in relative or any(p in {"", ".", ".."} for p in relative.split("/")):
        raise ValueError(f"Expected a normalized relative path: {relative}")
    if any(p.lower() in forbidden or p.lower().startswith(".env") for p in path.parts):
        raise ValueError("Credential and environment directories cannot be captured")
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"Symlinks cannot be captured: {relative}")
    if not current.is_file() or current.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"Missing, non-file or oversized material: {relative}")
    with current.open("rb") as handle:
        content = handle.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("Material grew beyond the capture size limit")
    return content


def _validate_action(action: Action, sources: set[str], roles: dict[str, str]) -> None:
    if not set(action.source_ids) <= sources or not set(action.evidence) <= roles.keys():
        raise ValueError("Action references an absent source or file")
    if any(roles[p] not in {"output", "log"} for p in action.evidence):
        raise ValueError("Action evidence must be an output or log")
    if action.environment is not None and roles.get(action.environment) != "environment":
        raise ValueError("Action environment must reference a captured environment file")
    if action.status == "not_run" and (action.evidence or action.checks or action.environment):
        raise ValueError("An unexecuted action cannot claim results")
    if action.status == "completed" and (not action.environment or not action.evidence or not action.checks):
        raise ValueError("Completed actions require environment, evidence and checks")
    if action.status == "completed" and not all(check.passed for check in action.checks):
        raise ValueError("A completed action cannot contain a failed check")


def _validate_record(record: Experiment, context: dict) -> None:
    if (record.session_id, record.scene_id, record.context_sha256) != (
        context["session_id"], context["scene"]["id"], _hash(_json_bytes(context))
    ):
        raise ValueError("Experiment is bound to a different public context")
    roles = {material.path: material.role for material in record.files}
    sources = {source.id for source in record.sources}
    if len(roles) != len(record.files) or len(sources) != len(record.sources):
        raise ValueError("Duplicate material path or source id")
    for source in record.sources:
        if roles.get(source.snapshot) != ("skill" if source.kind == "skill" else "source"):
            raise ValueError("Source requires a captured snapshot of the matching role")
    for action in record.actions:
        _validate_action(action, sources, roles)


def prepare_exploration(context_path: Path, output_dir: Path) -> None:
    """Prepare an unfilled task in a new local workspace from public context JSON."""
    context = _context(context_path)
    record = {"format": "studium/exploration/v1", "session_id": context["session_id"],
              "scene_id": context["scene"]["id"], "context_sha256": _hash(_json_bytes(context)),
              "question": "", "hypothesis": "", "sources": [], "files": [], "actions": [],
              "learner_observation": None}
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "context.json").write_bytes(_json_bytes(context))
    (output_dir / "experiment.json").write_bytes(_json_bytes(record))
    (output_dir / "experiment.schema.json").write_bytes(_json_bytes(Experiment.model_json_schema()))
    (output_dir / "task.md").write_text((Path(__file__).parent / "prompts/exploration_task.md").read_text())


def seal_exploration(workspace: Path, output_dir: Path) -> None:
    """Snapshot only named materials into a new portable receipt; run nothing."""
    if output_dir.exists():
        raise FileExistsError(output_dir)
    context = _context(workspace / "context.json")
    record = Experiment.model_validate(_read_json(workspace / "experiment.json"))
    _validate_record(record, context)
    files = _capture_files(workspace, record.files)
    manifest = {"format": "studium/exploration-receipt/v1", "files": {
        name: {"sha256": _hash(content), "bytes": len(content)} for name, content in files.items()}}
    for name, value in [("context.json", context), ("experiment.json", record.model_dump(mode="json"))]:
        manifest[name] = _hash(_json_bytes(value))
    output_dir.mkdir(parents=True, exist_ok=False)
    try:
        _write_receipt(output_dir, (context, record, manifest), files)
    except Exception:
        shutil.rmtree(output_dir)
        raise


def _capture_files(workspace: Path, materials: list[Material]) -> dict[str, bytes]:
    files = {}
    size = 0
    for material in materials:
        content = _read_material(workspace, material.path)
        size += len(content)
        if size > MAX_TOTAL_BYTES:
            raise ValueError("Exploration exceeds the total capture size limit")
        files[material.path] = content
    return files


def _write_receipt(output: Path, documents: tuple, files: dict[str, bytes]) -> None:
    context, record, manifest = documents
    (output / "files").mkdir()
    for content in files.values():
        (output / "files" / _hash(content)).write_bytes(content)
    (output / "context.json").write_bytes(_json_bytes(context))
    (output / "experiment.json").write_bytes(_json_bytes(record.model_dump(mode="json")))
    (output / "receipt.json").write_bytes(_json_bytes(manifest))


def verify_exploration(receipt: Path, context_path: Path | None = None) -> dict:
    """Check portable snapshot integrity, optionally against freshly fetched context."""
    context = _context(receipt / "context.json")
    record = Experiment.model_validate(_read_json(receipt / "experiment.json"))
    manifest = _read_json(receipt / "receipt.json")
    _validate_record(record, context)
    if context_path is not None and _hash(_json_bytes(_context(context_path))) != record.context_sha256:
        raise ValueError("Current context differs; do not reuse a stale exploration")
    _verify_manifest(receipt, manifest, record)
    return {"integrity": "consistent", "session_id": record.session_id, "scene_id": record.scene_id,
            "execution": "operator-reported, not independently attested", "grading": "not submitted",
            "learner_observation": record.learner_observation.model_dump() if record.learner_observation else None}


def _verify_manifest(receipt: Path, manifest: dict, record: Experiment) -> None:
    if {p.name for p in receipt.iterdir()} != {"context.json", "experiment.json", "receipt.json", "files"}:
        raise ValueError("Receipt contains unexpected or missing files")
    if set(manifest) != {"format", "files", "context.json", "experiment.json"}:
        raise ValueError("Invalid receipt fields")
    if manifest["format"] != "studium/exploration-receipt/v1" or not isinstance(manifest["files"], dict):
        raise ValueError("Invalid receipt format")
    if set(manifest["files"]) != {material.path for material in record.files}:
        raise ValueError("Receipt does not cover exactly the named materials")
    for name in ("context.json", "experiment.json"):
        if manifest[name] != _hash(_read_material(receipt, name)):
            raise ValueError(f"Changed document: {name}")
    for metadata in manifest["files"].values():
        _verify_blob(receipt, metadata)
    if {p.name for p in (receipt / "files").iterdir()} != {m["sha256"] for m in manifest["files"].values()}:
        raise ValueError("Receipt contains unexpected or missing blobs")


def _verify_blob(receipt: Path, metadata: dict) -> None:
    if not isinstance(metadata, dict) or set(metadata) != {"sha256", "bytes"}:
        raise ValueError("Invalid material metadata")
    digest = metadata["sha256"]
    if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Invalid material hash")
    content = _read_material(receipt, f"files/{digest}")
    if _hash(content) != digest or type(metadata["bytes"]) is not int or len(content) != metadata["bytes"]:
        raise ValueError("Changed material content")


def main() -> int:
    """Run prepare, seal or verify without invoking another process or service."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--context", type=Path, required=True)
    prepare.add_argument("--out", type=Path, required=True)
    seal = commands.add_parser("seal")
    seal.add_argument("--workspace", type=Path, required=True)
    seal.add_argument("--out", type=Path, required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("receipt", type=Path)
    verify.add_argument("--context", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            prepare_exploration(args.context, args.out)
        elif args.command == "seal":
            seal_exploration(args.workspace, args.out)
        else:
            print(json.dumps(verify_exploration(args.receipt, args.context), indent=2))
    except (ValueError, OSError) as error:
        parser.exit(1, f"Exploration rejected: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
