#!/usr/bin/env python3
"""Prepare provider-neutral media requests and attach checked local results."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from activity_presentation import load_presentation
from activity_support import (
    MAX_ASSETS, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, MAX_TOTAL_MEDIA_BYTES,
    SupportValidationError, prepare_support,
)
from experience_templates import _render_viewer, activity_digest, validate_prepared_activity


MAX_JSON_BYTES = 1_000_000
MAX_TEXT_BYTES = 1_000_000
MAX_MEDIA_BYTES = 20 * 1024 * 1024
# Prepared presentations may contain the support validator's 10 MiB of images and
# 30 MiB of audio/video after base64 expansion, plus bounded text metadata.
MAX_PRESENTATION_BYTES = 64 * 1024 * 1024
MAX_PROVENANCE_BYTES = 64 * 1024 * 1024
MAX_ATTACHMENT_HISTORY = 64
OUTPUT_FORMATS = {
    "image": {"png", "jpg", "jpeg", "webp"},
    "audio": {"mp3", "wav"},
    "video": {"mp4", "webm"},
}
PLACEMENTS = {"before_prediction", "after_prediction"}
SOURCE_ROLES = {"primary_evidence", "reference", "reconstruction_constraint"}
RIGHTS_SCOPES = {"private", "course", "public"}
BRIEF_FIELDS = {
    "expected_output", "expected_format", "download_filename", "output_filename", "prompt", "language",
    "pedagogical_goal", "source_refs", "text_fallback", "accessibility", "placement",
}
SOURCE_FIELDS = {"title", "origin", "provenance", "rights", "alt", "captions_language"}


class MediaWorkflowError(ValueError):
    """Raised when a request or attachment is stale, unsafe, or incomplete."""


def prepare_request(activity_dir: Path, brief_path: Path, output_path: Path) -> dict[str, Any]:
    """Write one digest-bound RenderAsset generation request without calling a provider."""
    activity_dir = _safe_directory(activity_dir, "activity")
    output_path = output_path.expanduser().resolve()
    if output_path.parent != activity_dir:
        raise MediaWorkflowError("media request must be written inside the bound activity directory")
    if output_path.exists():
        raise FileExistsError(output_path)
    activity = _load_activity(activity_dir)
    brief = _validate_brief(_read_json(brief_path, "teacher brief"))
    request = _request_asset(activity, brief)
    _validate_request_with_support(request)
    prompt_path = activity_dir / brief["download_filename"]
    if prompt_path == output_path or prompt_path.exists() or prompt_path.is_symlink():
        raise FileExistsError(prompt_path)
    with prompt_path.open("x", encoding="utf-8") as stream:
        stream.write(request["payload"])
    with output_path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(request, indent=2, ensure_ascii=False) + "\n")
    return request


def attach_media(
    request_path: Path,
    media_path: Path,
    source_metadata_path: Path,
    output_dir: Path,
    *,
    transcript_path: Path | None = None,
    captions_path: Path | None = None,
) -> Path:
    """Attach checked local media to a new rendered activity directory."""
    request_path = _safe_file(request_path, "media request", MAX_JSON_BYTES)
    activity_dir = request_path.parent
    request = _validate_request(_read_json(request_path, "media request"))
    generation = request["meta"]["generation"]
    raw_activity = _read_json(activity_dir / "activity.json", "activity")
    if generation["activity_id"] != raw_activity.get("activity_id") or generation["activity_sha256"] != _sha256(_canonical_bytes(raw_activity)):
        raise MediaWorkflowError("media request is stale for this activity")
    activity = _load_activity(activity_dir)
    output_dir = output_dir.expanduser().resolve()
    if output_dir.exists():
        raise FileExistsError(output_dir)
    if _is_within(output_dir, activity_dir):
        raise MediaWorkflowError("enriched output must be outside the original activity directory")
    source = _validate_source(_read_json(source_metadata_path, "source metadata"))
    transcript = _required_text(transcript_path, "transcript") if generation["expected_output"] in {"audio", "video"} else None
    captions = _required_text(captions_path, "captions") if generation["expected_output"] == "video" else None
    media_path = _safe_file(media_path, "media", MAX_MEDIA_BYTES)
    media_bytes = media_path.read_bytes()
    _require_expected_extension(media_path, generation)
    prepared_asset = _prepare_attachment(request, source, media_bytes, transcript, captions)
    presentation = _load_parent_presentation(activity_dir)
    if request not in presentation["render_assets"]:
        presentation["render_assets"].append(request)
    presentation["render_assets"].append(prepared_asset)
    _validate_combined_budget(presentation["render_assets"])
    viewer = _render_viewer(activity, presentation)
    _write_enriched_directory(
        activity_dir, output_dir, request_path, media_bytes, source_metadata_path,
        transcript_path, captions_path, activity, request, source, presentation, viewer,
    )
    return output_dir


def _validate_combined_budget(assets: list[dict[str, Any]]) -> None:
    """Enforce the preparation limits across old and newly attached media."""
    if len(assets) > MAX_ASSETS:
        raise MediaWorkflowError("combined support asset count exceeds the limit")
    image_bytes = media_bytes = 0
    for asset in assets:
        kind = asset.get("kind")
        if kind not in {"image", "audio", "video"}:
            continue
        uri = asset.get("path", "")
        if not isinstance(uri, str) or not uri.startswith(f"data:{kind}/") or ";base64," not in uri:
            raise MediaWorkflowError("parent media must use prepared inline data")
        try:
            size = len(base64.b64decode(uri.split(";base64,", 1)[1], validate=True))
        except (ValueError, binascii.Error) as error:
            raise MediaWorkflowError("parent media encoding is invalid") from error
        limit = MAX_IMAGE_BYTES if kind == "image" else MAX_MEDIA_BYTES
        if size > limit:
            raise MediaWorkflowError("combined support contains an oversized media item")
        if kind == "image":
            image_bytes += size
        else:
            media_bytes += size
    if image_bytes > MAX_TOTAL_IMAGE_BYTES:
        raise MediaWorkflowError("combined support exceeds the aggregate image budget")
    if media_bytes > MAX_TOTAL_MEDIA_BYTES:
        raise MediaWorkflowError("combined support exceeds the aggregate audio/video budget")


def _request_asset(activity: dict[str, Any], brief: dict[str, Any]) -> dict[str, Any]:
    """Build the canonical passive generation-request asset."""
    accessibility = brief["accessibility"]
    source_refs = [f"{item['role']}:{item['id']}:{item['locator']}" for item in brief["source_refs"]]
    accessibility_text = (
        f"alt={accessibility['alt']}; transcript_required={str(accessibility['transcript_required']).lower()}; "
        f"captions_required={str(accessibility['captions_required']).lower()}"
    )
    request_text = (
        f"Target language: {brief['language']}\n"
        f"Output: {brief['expected_output']}/{brief['expected_format']} as {brief['output_filename']}\n"
        f"Prompt download: {brief['download_filename']}\n"
        f"Accessibility: {accessibility_text}\n"
        f"Pedagogical goal: {brief['pedagogical_goal']}\n\n"
        "Evidence boundary: Treat references marked primary_evidence as source material. "
        "Label any generated reconstruction as a reconstruction; do not present inferred or generated details as observed evidence.\n\n"
        "Execution handoff:\n"
        "1. Run the Generation request below with an available media tool only when the teacher asks. "
        "Studium has not selected or called a provider.\n"
        f"2. Save the returned media bytes as {brief['output_filename']}.\n"
        "3. Attach the saved local file to a new activity directory with:\n"
        "   python tools/media_workflow.py attach --request [request.json] "
        f"--media [{brief['output_filename']}] --source-metadata [source-metadata.json] --out [new-activity-dir]\n\n"
        f"Generation request:\n{brief['prompt']}\n\n"
        "Use only the explicit source references below as constraints; a URL is a locator, not proof of trust or rights.\n"
        + "\n".join(f"- {reference}" for reference in source_refs)
        + f"\n\nRequired text fallback:\n{brief['text_fallback']}"
    )
    return {
        "kind": "protocol_md",
        "title": f"Media request for {activity['activity_id']}",
        "payload": request_text,
        "language": brief["language"],
        "format": "studium-media-prompt",
        "provenance": "Teacher-authored local request; no provider was selected or called by Studium.",
        "meta": {
            "alt": accessibility["alt"],
            # A prompt is workflow guidance, so it remains after the prediction.
            # The requested media uses generation.placement below.
            "placement": "after_prediction",
            "generation": {
                "expected_output": brief["expected_output"],
                "expected_format": brief["expected_format"],
                "download_filename": brief["download_filename"],
                "output_filename": brief["output_filename"],
                "activity_id": activity["activity_id"],
                "activity_sha256": activity_digest(activity),
                "language": brief["language"],
                "pedagogical_goal": brief["pedagogical_goal"],
                "source_refs": source_refs,
                "text_fallback": brief["text_fallback"],
                "accessibility": accessibility_text,
                "placement": brief["placement"],
            },
        },
    }


def _validate_brief(value: dict[str, Any]) -> dict[str, Any]:
    """Validate the explicit teacher input used to build a generation request."""
    _exact_fields(value, BRIEF_FIELDS, "teacher brief")
    value = deepcopy(value)
    for field in ("expected_output", "expected_format", "download_filename", "output_filename", "prompt", "language", "pedagogical_goal", "text_fallback", "placement"):
        _nonempty(value.get(field), f"teacher brief {field}")
    output = value["expected_output"]
    if output not in OUTPUT_FORMATS or value["expected_format"].lower() not in OUTPUT_FORMATS[output]:
        raise MediaWorkflowError("teacher brief output kind and format are inconsistent")
    if value["placement"] not in PLACEMENTS:
        raise MediaWorkflowError("teacher brief placement is invalid")
    try:
        value["language"] = load_presentation(language=value["language"])["language"]
    except ValueError as error:
        raise MediaWorkflowError("teacher brief language must be a valid BCP 47 tag") from error
    _safe_download_name(value["download_filename"], "txt")
    _safe_download_name(value["output_filename"], value["expected_format"])
    sources = value.get("source_refs")
    if not isinstance(sources, list) or not sources:
        raise MediaWorkflowError("teacher brief needs explicit source references")
    for source in sources:
        _exact_fields(source, {"id", "locator", "role"}, "source reference")
        _nonempty(source.get("id"), "source reference id")
        _nonempty(source.get("locator"), "source reference locator")
        if source.get("role") not in SOURCE_ROLES:
            raise MediaWorkflowError("source reference role is invalid")
    accessibility = value.get("accessibility")
    _exact_fields(accessibility, {"alt", "transcript_required", "captions_required"}, "accessibility request")
    _nonempty(accessibility.get("alt"), "accessibility alt text")
    if not all(isinstance(accessibility.get(field), bool) for field in ("transcript_required", "captions_required")):
        raise MediaWorkflowError("accessibility requirements must be booleans")
    if (output in {"audio", "video"}) != accessibility["transcript_required"]:
        raise MediaWorkflowError("audio and video require a transcript")
    if (output == "video") != accessibility["captions_required"]:
        raise MediaWorkflowError("video requires captions")
    return value


def _validate_request(value: dict[str, Any]) -> dict[str, Any]:
    """Validate a canonical request by the shared scientific-support boundary."""
    try:
        with tempfile.TemporaryDirectory(prefix="studium-request-") as directory:
            sidecar = Path(directory) / "support.json"
            sidecar.write_text(json.dumps({"render_assets": [value]}), encoding="utf-8")
            [validated] = prepare_support(sidecar)
    except (SupportValidationError, OSError) as error:
        raise MediaWorkflowError(str(error)) from error
    return validated


def _validate_request_with_support(value: dict[str, Any]) -> None:
    """Reject requests outside the shared RenderAsset profile."""
    _validate_request(value)


def _validate_source(value: dict[str, Any]) -> dict[str, Any]:
    """Validate authored origin and rights claims without certifying them."""
    if not isinstance(value, dict) or not set(value) <= SOURCE_FIELDS:
        raise MediaWorkflowError("source metadata has unknown fields")
    for field in ("title", "origin", "provenance"):
        _nonempty(value.get(field), f"source metadata {field}")
    if value["origin"] not in {"source", "generated"}:
        raise MediaWorkflowError("source metadata origin is invalid")
    rights = value.get("rights")
    if not isinstance(rights, dict) or not set(rights) <= {"creator", "license", "evidence_url", "scope", "adaptations"}:
        raise MediaWorkflowError("source rights metadata is invalid")
    for field in ("creator", "license", "evidence_url"):
        _nonempty(rights.get(field), f"source rights {field}")
    if rights.get("scope") not in RIGHTS_SCOPES:
        raise MediaWorkflowError("source rights scope is invalid")
    if "adaptations" in rights:
        _nonempty(rights["adaptations"], "source rights adaptations")
    unknown = any(str(rights[field]).strip().lower() == "unknown" for field in ("creator", "license", "evidence_url"))
    if unknown and rights["scope"] != "private":
        raise MediaWorkflowError("unknown rights must retain private scope")
    if "alt" in value:
        _nonempty(value["alt"], "source metadata alt")
    if "captions_language" in value:
        _nonempty(value["captions_language"], "captions language")
    return deepcopy(value)


def _prepare_attachment(
    request: dict[str, Any], source: dict[str, Any], media: bytes,
    transcript: str | None, captions: str | None,
) -> dict[str, Any]:
    """Pass an attached media asset through the shared support validator."""
    generation = request["meta"]["generation"]
    kind = generation["expected_output"]
    with tempfile.TemporaryDirectory(prefix="studium-media-") as directory:
        staging = Path(directory)
        media_name = generation["output_filename"]
        (staging / media_name).write_bytes(media)
        meta: dict[str, Any] = {
            "alt": source.get("alt", request["meta"]["alt"]),
            "origin": source["origin"], "rights": source["rights"],
            "placement": generation["placement"],
        }
        if transcript is not None:
            meta["transcript"] = transcript
        if captions is not None:
            (staging / "captions.vtt").write_text(captions, encoding="utf-8")
            meta.update(captions_path="captions.vtt", captions_language=source.get("captions_language", generation["language"]))
        asset = {
            "kind": kind, "title": source["title"], "path": media_name,
            "format": generation["expected_format"], "provenance": source["provenance"], "meta": meta,
        }
        sidecar = staging / "support.json"
        sidecar.write_text(json.dumps({"render_assets": [asset]}), encoding="utf-8")
        try:
            [prepared] = prepare_support(sidecar)
        except SupportValidationError as error:
            raise MediaWorkflowError(str(error)) from error
    return prepared


def _load_activity(directory: Path) -> dict[str, Any]:
    """Load only the canonical public activity document from a prepared directory."""
    try:
        return validate_prepared_activity(_read_json(directory / "activity.json", "activity"))
    except (ValueError, OSError) as error:
        raise MediaWorkflowError(str(error)) from error


def _load_parent_presentation(directory: Path) -> dict[str, Any]:
    """Load the bounded public presentation or the established default."""
    path = directory / "presentation.json"
    if not path.exists():
        return load_presentation()
    value = _read_json(path, "presentation", MAX_PRESENTATION_BYTES)
    if set(value) != {"language", "translations", "render_assets"} or not isinstance(value["render_assets"], list):
        raise MediaWorkflowError("parent presentation has unknown fields")
    return deepcopy(value)


def _write_enriched_directory(
    source_dir: Path, output_dir: Path, request_path: Path, media: bytes,
    source_metadata_path: Path, transcript_path: Path | None, captions_path: Path | None,
    activity: dict[str, Any], request: dict[str, Any], source: dict[str, Any],
    presentation: dict[str, Any], viewer: str,
) -> None:
    """Write a new public activity tree without copying learner-private files."""
    parent_provenance_path = _safe_file(
        source_dir / "provenance.json", "parent provenance", MAX_PROVENANCE_BYTES,
    )
    parent_provenance = _read_json(
        parent_provenance_path, "parent provenance", MAX_PROVENANCE_BYTES,
    )
    history = parent_provenance.get("media_attachment_history", [])
    if not isinstance(history, list) or len(history) >= MAX_ATTACHMENT_HISTORY:
        raise MediaWorkflowError(f"media attachment history limit is {MAX_ATTACHMENT_HISTORY}")
    generation = request["meta"]["generation"]
    public_files = ["activity.json", "task.md", "learner-actions.schema.json"]
    copies = {name: _safe_file(source_dir / name, name, MAX_JSON_BYTES).read_bytes() for name in public_files}
    source_metadata_path = _safe_file(source_metadata_path, "source metadata", MAX_JSON_BYTES)
    output_dir.mkdir()
    for name, content in copies.items():
        (output_dir / name).write_bytes(content)
    (output_dir / "index.html").write_text(viewer, encoding="utf-8")
    (output_dir / "presentation.json").write_text(json.dumps(presentation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / "media-request.json").write_bytes(request_path.read_bytes())
    media_dir = output_dir / "media"
    media_dir.mkdir()
    (media_dir / generation["output_filename"]).write_bytes(media)
    (media_dir / "source-metadata.json").write_bytes(source_metadata_path.read_bytes())
    if transcript_path is not None:
        (media_dir / "transcript.txt").write_bytes(_safe_file(transcript_path, "transcript", MAX_TEXT_BYTES).read_bytes())
    if captions_path is not None:
        (media_dir / "captions.vtt").write_bytes(_safe_file(captions_path, "captions", MAX_TEXT_BYTES).read_bytes())
    attachment_record = {
        "request": deepcopy(request),
        "source_metadata": deepcopy(source),
        "parent_activity_sha256": activity_digest(activity),
        "media_request_sha256": _sha256(request_path.read_bytes()),
        "media_output_sha256": _sha256(media),
        "media_source_metadata_sha256": _sha256(source_metadata_path.read_bytes()),
        "presentation_sha256": _sha256(_canonical_bytes(presentation)),
        "viewer_sha256": _sha256(viewer.encode("utf-8")),
    }
    if transcript_path is not None:
        attachment_record["media_transcript_sha256"] = _sha256(
            _safe_file(transcript_path, "transcript", MAX_TEXT_BYTES).read_bytes(),
        )
    if captions_path is not None:
        attachment_record["media_captions_sha256"] = _sha256(
            _safe_file(captions_path, "captions", MAX_TEXT_BYTES).read_bytes(),
        )
    provenance = deepcopy(parent_provenance)
    provenance["media_attachment_history"] = [*deepcopy(history), attachment_record]
    provenance.update({
        key: value for key, value in attachment_record.items()
        if key.endswith("_sha256")
    })
    provenance.update({
        "parent_provenance_sha256": _sha256(parent_provenance_path.read_bytes()),
        "rights_status": "authored claim; not automatically certified",
        "provider_execution": "external local attachment; Studium called no provider",
    })
    (output_dir / "provenance.json").write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _read_json(path: Path, label: str, limit: int = MAX_JSON_BYTES) -> dict[str, Any]:
    """Read a bounded, duplicate-free JSON object."""
    path = _safe_file(path, label, limit)
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise MediaWorkflowError(f"{label} must be valid UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise MediaWorkflowError(f"{label} must be a JSON object")
    return value


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Reject duplicate JSON keys."""
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise MediaWorkflowError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _safe_directory(path: Path, label: str) -> Path:
    """Resolve a real non-symlink directory."""
    path = path.expanduser()
    if path.is_symlink() or not path.is_dir():
        raise MediaWorkflowError(f"{label} directory is missing or a symlink")
    return path.resolve()


def _safe_file(path: Path, label: str, limit: int) -> Path:
    """Resolve a bounded regular file without following a supplied symlink."""
    path = path.expanduser()
    if path.is_symlink() or not path.is_file():
        raise MediaWorkflowError(f"{label} file is missing or a symlink")
    resolved = path.resolve()
    if resolved.stat().st_size > limit:
        raise MediaWorkflowError(f"{label} exceeds the size limit")
    return resolved


def _required_text(path: Path | None, label: str) -> str:
    """Read required bounded UTF-8 accessibility text."""
    if path is None:
        raise MediaWorkflowError(f"{label} is required")
    try:
        text = _safe_file(path, label, MAX_TEXT_BYTES).read_text(encoding="utf-8")
    except UnicodeError as error:
        raise MediaWorkflowError(f"{label} must be UTF-8 text") from error
    if not text.strip():
        raise MediaWorkflowError(f"{label} must not be blank")
    return text


def _exact_fields(value: object, fields: set[str], label: str) -> dict[str, Any]:
    """Require an object with exactly the named fields."""
    if not isinstance(value, dict) or set(value) != fields:
        raise MediaWorkflowError(f"{label} fields are invalid")
    return value


def _nonempty(value: object, label: str) -> str:
    """Return non-empty bounded text."""
    if not isinstance(value, str) or not value.strip() or len(value) > 64_000:
        raise MediaWorkflowError(f"{label} must be non-empty bounded text")
    return value


def _safe_download_name(name: str, expected_format: str) -> None:
    """Require a local basename with the declared output extension."""
    if Path(name).name != name or name in {".", ".."}:
        raise MediaWorkflowError("download filename must be a local basename")
    if Path(name).suffix.lower().removeprefix(".") != expected_format.lower():
        raise MediaWorkflowError("download filename extension does not match expected format")


def _require_expected_extension(path: Path, generation: dict[str, Any]) -> None:
    """Require the returned file extension to match the request contract."""
    actual = path.suffix.lower().removeprefix(".")
    expected = generation["expected_format"].lower()
    if actual != expected and {actual, expected} != {"jpg", "jpeg"}:
        raise MediaWorkflowError("media file extension does not match the request")


def _is_within(path: Path, directory: Path) -> bool:
    """Return whether a path is equal to or below a directory."""
    try:
        path.relative_to(directory)
        return True
    except ValueError:
        return False


def _canonical_bytes(value: object) -> bytes:
    """Serialize JSON deterministically for provenance hashing."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()


def _sha256(value: bytes) -> str:
    """Return a lowercase SHA-256 digest."""
    return hashlib.sha256(value).hexdigest()


def _parser() -> argparse.ArgumentParser:
    """Build the command-line interface."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="write a provider-neutral request")
    prepare.add_argument("--activity", type=Path, required=True)
    prepare.add_argument("--brief", type=Path, required=True)
    prepare.add_argument("--out", type=Path, required=True)
    attach = commands.add_parser("attach", help="attach one checked local output")
    attach.add_argument("--request", type=Path, required=True)
    attach.add_argument("--media", type=Path, required=True)
    attach.add_argument("--source-metadata", type=Path, required=True)
    attach.add_argument("--transcript", type=Path)
    attach.add_argument("--captions", type=Path)
    attach.add_argument("--out", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the local prepare or attach command without selecting a provider."""
    args = _parser().parse_args(argv)
    try:
        if args.command == "prepare":
            prepare_request(args.activity, args.brief, args.out)
            print(json.dumps({"request": str(args.out.expanduser().resolve()), "provider_called": False}))
        else:
            output = attach_media(
                args.request, args.media, args.source_metadata, args.out,
                transcript_path=args.transcript, captions_path=args.captions,
            )
            print(json.dumps({"output": str(output), "provider_called": False}))
        return 0
    except (MediaWorkflowError, FileExistsError, OSError, ValueError) as error:
        print(f"media workflow: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
