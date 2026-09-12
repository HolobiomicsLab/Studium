"""Prepare bounded RenderAsset sidecars for portable activity viewers."""

from __future__ import annotations

import base64
import binascii
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any


CANONICAL_FIELDS = {"kind", "title", "payload", "path", "language", "format", "provenance", "meta"}
SUPPORTED_KINDS = {"image", "audio", "video", "equation_latex", "code", "mol_3d", "protocol_md"}
IMAGE_TYPES = {
    ".gif": ("image/gif", (b"GIF87a", b"GIF89a")),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".webp": ("image/webp", (b"RIFF",)),
}
MIME_SIGNATURES = {mime: signatures for mime, signatures in IMAGE_TYPES.values()}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024
MAX_MEDIA_BYTES = 20 * 1024 * 1024
MAX_TOTAL_MEDIA_BYTES = 30 * 1024 * 1024
MAX_CAPTIONS_BYTES = 1024 * 1024
MAX_PAYLOAD_CHARS = 64 * 1024
MAX_SIDECAR_BYTES = 1024 * 1024
MAX_ASSETS = 64
AI_IMAGE_NOTICE = "AI-generated image; details may be inaccurate."
AI_MEDIA_NOTICES = {
    "audio": "AI-generated audio; details may be inaccurate.",
    "video": "AI-generated video; details may be inaccurate.",
}
MEDIA_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
}
PLACEMENTS = {"before_prediction", "after_prediction"}
RIGHTS_SCOPES = {"private", "course", "public"}
UNSAFE_MERMAID = (
    re.compile(r"<\s*/?\s*[a-z!]", re.IGNORECASE),
    re.compile(r"%%\s*\{"),
    re.compile(r"^\s*click\b", re.IGNORECASE | re.MULTILINE),
    re.compile(r"(?:https?:|javascript:|data:|file:|//)", re.IGNORECASE),
    re.compile(r"\b(?:href|src)\s*=", re.IGNORECASE),
    re.compile(r"@\{[^}]*\b(?:img|icon)\s*:", re.IGNORECASE),
)


class SupportValidationError(ValueError):
    """Raised when a support sidecar is unsafe or outside the bounded profile."""


@dataclass
class _PreparationContext:
    """Track the sidecar directory and aggregate image budget."""

    base_dir: Path
    remaining_image_bytes: int = MAX_TOTAL_IMAGE_BYTES
    remaining_media_bytes: int = MAX_TOTAL_MEDIA_BYTES


def prepare_support(path: str | Path) -> list[dict[str, Any]]:
    """Validate a sidecar and return canonical assets safe to inline in a viewer."""
    sidecar_path = Path(path).expanduser().resolve()
    document = _read_sidecar(sidecar_path)
    assets = document.get("render_assets")
    if not isinstance(assets, list) or len(assets) > MAX_ASSETS:
        raise SupportValidationError(f"render_assets must be a list of at most {MAX_ASSETS} items")
    context = _PreparationContext(sidecar_path.parent)
    return [_prepare_asset(asset, context) for asset in assets]


def _read_sidecar(path: Path) -> dict[str, Any]:
    """Read a size-bounded JSON object."""
    try:
        with path.open("rb") as sidecar:
            raw = sidecar.read(MAX_SIDECAR_BYTES + 1)
        if len(raw) > MAX_SIDECAR_BYTES:
            raise SupportValidationError("support sidecar is missing or too large")
        document = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise SupportValidationError("support sidecar must be valid UTF-8 JSON") from error
    if not isinstance(document, dict):
        raise SupportValidationError("support sidecar must be an object")
    return document


def _prepare_asset(value: object, context: _PreparationContext) -> dict[str, Any]:
    """Validate one asset and inline an image when required."""
    if not isinstance(value, dict):
        raise SupportValidationError("each render asset must be an object")
    asset = deepcopy(value)
    _validate_canonical_fields(asset)
    _validate_common_fields(asset)
    kind = asset["kind"]
    if kind == "image":
        asset["path"] = _prepare_image(asset["path"], context)
        _mark_image_origin(asset)
    elif kind in {"audio", "video"}:
        _prepare_media(asset, context)
    elif kind == "equation_latex":
        _require_inline_payload(asset)
    elif kind == "code":
        _validate_mermaid(asset)
    elif kind == "protocol_md":
        _validate_generation_prompt(asset)
    else:
        _validate_smiles(asset)
    return asset


def _validate_canonical_fields(asset: dict[str, Any]) -> None:
    """Reject fields that are not part of the canonical RenderAsset contract."""
    unknown = set(asset) - CANONICAL_FIELDS
    if unknown:
        raise SupportValidationError(f"non-canonical render asset fields: {sorted(unknown)}")
    if asset.get("kind") not in SUPPORTED_KINDS:
        raise SupportValidationError(f"kind {asset.get('kind')!r} is not supported by scientific supports")
    for field in ("title", "payload", "path", "language", "format"):
        if field in asset and (not isinstance(asset[field], str) or not asset[field].strip()):
            raise SupportValidationError(f"render asset {field} must be a non-empty string")


def _validate_common_fields(asset: dict[str, Any]) -> None:
    """Require one content source, provenance and an accessible description."""
    has_payload = "payload" in asset
    has_path = "path" in asset
    if has_payload == has_path:
        raise SupportValidationError("render asset needs exactly one non-empty payload or path")
    if not isinstance(asset.get("provenance"), str) or not asset["provenance"].strip():
        raise SupportValidationError("render asset provenance is required")
    meta = asset.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("alt"), str) or not meta["alt"].strip():
        raise SupportValidationError("render asset meta.alt is required for accessible fallback")
    if "placement" in meta and meta["placement"] not in PLACEMENTS:
        raise SupportValidationError("support placement must be before_prediction or after_prediction")


def _require_inline_payload(asset: dict[str, Any]) -> str:
    """Return a bounded inline payload or reject the asset."""
    payload = asset.get("payload")
    if not isinstance(payload, str) or not payload.strip() or len(payload) > MAX_PAYLOAD_CHARS:
        raise SupportValidationError("support payload must be non-empty and size-bounded")
    return payload


def _validate_mermaid(asset: dict[str, Any]) -> None:
    """Accept Mermaid code only when it has no active or network-capable syntax."""
    if asset.get("language") != "mermaid":
        raise SupportValidationError("code support must use language 'mermaid'")
    payload = _require_inline_payload(asset)
    if any(pattern.search(payload) for pattern in UNSAFE_MERMAID):
        raise SupportValidationError("unsafe Mermaid source is not allowed")


def _validate_smiles(asset: dict[str, Any]) -> None:
    """Require SMILES for the established 2D chemistry renderer."""
    if asset.get("format") != "smiles":
        raise SupportValidationError("molecule support must use SMILES format")
    payload = _require_inline_payload(asset)
    if any(ord(character) < 32 for character in payload):
        raise SupportValidationError("SMILES payload contains control characters")


def _prepare_media(asset: dict[str, Any], context: _PreparationContext) -> None:
    """Validate audio/video metadata and inline local media and captions."""
    kind = asset["kind"]
    meta = asset["meta"]
    _validate_media_meta(kind, meta)
    uri, size, media_format = _encode_media(asset["path"], kind, context.base_dir)
    if "format" in asset and asset["format"].lower() != media_format:
        raise SupportValidationError(f"{kind} format does not match its file")
    if size > context.remaining_media_bytes:
        raise SupportValidationError("audio and video exceed the aggregate size budget")
    context.remaining_media_bytes -= size
    asset["path"] = uri
    asset.setdefault("format", media_format)
    if kind == "video":
        meta["captions_data_uri"] = _prepare_captions(meta.pop("captions_path"), context.base_dir)
    if meta["origin"] == "generated":
        meta["ai_disclaimer"] = AI_MEDIA_NOTICES[kind]


def _validate_media_meta(kind: str, meta: dict[str, Any]) -> None:
    """Require origin, transcript, rights and video captions metadata."""
    if meta.get("origin") not in {"source", "generated"}:
        raise SupportValidationError(f"{kind} meta.origin must be 'source' or 'generated'")
    if not _nonempty(meta.get("transcript")):
        raise SupportValidationError(f"{kind} transcript is required")
    _validate_rights(meta.get("rights"))
    if kind != "video":
        return
    if not _nonempty(meta.get("captions_path")) or not _nonempty(meta.get("captions_language")):
        raise SupportValidationError("video captions path and language are required")
    if not re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", meta["captions_language"]):
        raise SupportValidationError("video captions language is invalid")


def _validate_rights(value: object) -> None:
    """Validate authored rights claims without adjudicating them."""
    if not isinstance(value, dict):
        raise SupportValidationError("media rights metadata is required")
    for field in ("creator", "license", "evidence_url"):
        if not _nonempty(value.get(field)):
            raise SupportValidationError(f"media rights {field} is required")
    evidence = value["evidence_url"].strip()
    if evidence.lower() != "unknown" and not re.match(r"^(?:https?://|urn:)", evidence, re.IGNORECASE):
        raise SupportValidationError("media rights evidence_url must be HTTP(S) or URN")
    if value.get("scope") not in RIGHTS_SCOPES:
        raise SupportValidationError("media rights scope must be private, course or public")
    is_unknown = any(value[field].strip().lower() == "unknown" for field in ("creator", "license", "evidence_url"))
    if is_unknown and value["scope"] != "private":
        raise SupportValidationError("unknown media rights must retain private scope")
    if "adaptations" in value and not _nonempty(value["adaptations"]):
        raise SupportValidationError("media rights adaptations must be a non-empty string")


def _encode_media(value: object, kind: str, base_dir: Path) -> tuple[str, int, str]:
    """Return a signature-checked local audio/video file as a data URI."""
    if not isinstance(value, str) or value.startswith("data:"):
        raise SupportValidationError(f"{kind} requires a local file path")
    media_path = _confined_path(value, base_dir, f"{kind} path")
    mime = MEDIA_TYPES.get(media_path.suffix.lower())
    if mime is None or not mime.startswith(f"{kind}/"):
        raise SupportValidationError(f"unsupported {kind} file type")
    data = _read_bounded(media_path, MAX_MEDIA_BYTES, f"{kind} file")
    if not _matches_media_signature(data, mime):
        raise SupportValidationError(f"{kind} content does not match its file type")
    uri = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    return uri, len(data), media_path.suffix.lower().removeprefix(".")


def _matches_media_signature(data: bytes, mime: str) -> bool:
    """Check the small set of supported media container signatures."""
    if mime == "audio/wav":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if mime == "audio/mpeg":
        return data.startswith(b"ID3") or len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0
    if mime == "video/mp4":
        return len(data) >= 12 and data[4:8] == b"ftyp"
    return data.startswith(b"\x1a\x45\xdf\xa3")


def _prepare_captions(value: object, base_dir: Path) -> str:
    """Validate a confined passive WebVTT file and return a data URI."""
    captions_path = _confined_path(value, base_dir, "captions path")
    if captions_path.suffix.lower() != ".vtt":
        raise SupportValidationError("video captions must use WebVTT")
    data = _read_bounded(captions_path, MAX_CAPTIONS_BYTES, "captions file")
    try:
        text = data.decode("utf-8")
    except UnicodeError as error:
        raise SupportValidationError("captions must be UTF-8 WebVTT") from error
    if not text.lstrip("\ufeff").startswith("WEBVTT") or _has_active_caption_markup(text):
        raise SupportValidationError("captions contain invalid or active WebVTT content")
    return f"data:text/vtt;base64,{base64.b64encode(data).decode('ascii')}"


def _has_active_caption_markup(text: str) -> bool:
    """Reject active markup and external references in captions."""
    active = r"<\s*/?\s*(?:script|style|img|svg|iframe|object|embed|audio|video|a)\b"
    external = r"(?:javascript:|data:|file:|https?://|//)"
    return "\x00" in text or bool(re.search(active, text, re.IGNORECASE)) or bool(re.search(external, text, re.IGNORECASE))


def _validate_generation_prompt(asset: dict[str, Any]) -> None:
    """Validate passive, digest-bound media-generation instructions."""
    if asset.get("format") != "studium-media-prompt":
        raise SupportValidationError("generation protocol must use studium-media-prompt format")
    payload = _require_inline_payload(asset)
    if re.search(r"<\s*/?\s*[a-z!]", payload, re.IGNORECASE):
        raise SupportValidationError("media generation prompt must be plain text")
    generation = asset["meta"].get("generation")
    if not isinstance(generation, dict):
        raise SupportValidationError("media generation metadata is required")
    _validate_generation_fields(generation)


def _validate_generation_fields(generation: dict[str, Any]) -> None:
    """Validate request binding, output and download metadata."""
    required = ("expected_format", "download_filename", "output_filename", "activity_id", "language", "pedagogical_goal", "text_fallback", "accessibility")
    if any(not _nonempty(generation.get(field)) for field in required):
        raise SupportValidationError("media generation metadata has missing text fields")
    if generation.get("expected_output") not in {"image", "audio", "video"}:
        raise SupportValidationError("media generation expected_output is invalid")
    formats = {"image": {"png", "jpg", "jpeg", "webp"}, "audio": {"wav", "mp3"}, "video": {"mp4", "webm"}}
    if generation["expected_format"].lower() not in formats[generation["expected_output"]]:
        raise SupportValidationError("media generation expected_format is invalid")
    if generation.get("placement") not in PLACEMENTS:
        raise SupportValidationError("media generation placement is invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", str(generation.get("activity_sha256", ""))):
        raise SupportValidationError("media generation activity_sha256 is invalid")
    if not _safe_local_filename(generation["download_filename"]) or not generation["download_filename"].endswith(".txt"):
        raise SupportValidationError("media generation download filename must be a local text file")
    output_name = generation["output_filename"]
    if not _safe_local_filename(output_name) or Path(output_name).suffix.lower() != f".{generation['expected_format'].lower()}":
        raise SupportValidationError("media generation output filename must match expected_format")
    refs = generation.get("source_refs")
    if not isinstance(refs, list) or any(not _nonempty(item) for item in refs):
        raise SupportValidationError("media generation source_refs must be text values")


def _nonempty(value: object) -> bool:
    """Return whether a value is non-empty text."""
    return isinstance(value, str) and bool(value.strip())


def _safe_local_filename(value: str) -> bool:
    """Return whether a download name is a plain local basename."""
    return Path(value).name == value and "/" not in value and "\\" not in value


def _confined_path(value: object, base_dir: Path, label: str) -> Path:
    """Resolve a relative path while rejecting directory escape."""
    if not isinstance(value, str) or Path(value).is_absolute():
        raise SupportValidationError(f"{label} must stay inside the support directory")
    resolved = (base_dir / value).resolve()
    try:
        resolved.relative_to(base_dir)
    except ValueError as error:
        raise SupportValidationError(f"{label} must stay inside the support directory") from error
    return resolved


def _read_bounded(path: Path, limit: int, label: str) -> bytes:
    """Read at most one byte beyond a local-file limit."""
    try:
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
    except OSError as error:
        raise SupportValidationError(f"{label} is missing or unreadable") from error
    if len(data) > limit:
        raise SupportValidationError(f"{label} exceeds the size limit")
    return data


def _prepare_image(value: object, context: _PreparationContext) -> str:
    """Return a checked raster image as a data URI."""
    if not isinstance(value, str):
        raise SupportValidationError("image support requires a path")
    if value.startswith("data:"):
        uri, size = _validate_data_uri(value)
        return _consume_image_budget(uri, size, context)
    image_path = (context.base_dir / value).resolve()
    try:
        image_path.relative_to(context.base_dir)
    except ValueError as error:
        raise SupportValidationError("image path must stay inside the support directory") from error
    uri, size = _encode_local_image(image_path)
    return _consume_image_budget(uri, size, context)


def _encode_local_image(path: Path) -> tuple[str, int]:
    """Validate and encode a confined local raster image."""
    image_type = IMAGE_TYPES.get(path.suffix.lower())
    if image_type is None:
        raise SupportValidationError("support images must use a supported raster type")
    try:
        with path.open("rb") as image:
            data = image.read(MAX_IMAGE_BYTES + 1)
    except OSError as error:
        raise SupportValidationError("support image is missing or too large") from error
    if len(data) > MAX_IMAGE_BYTES:
        raise SupportValidationError("support image is missing or too large")
    mime, signatures = image_type
    if not any(data.startswith(signature) for signature in signatures) or not _valid_webp(data, mime):
        raise SupportValidationError("support image content does not match its raster type")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}", len(data)


def _valid_webp(data: bytes, mime: str) -> bool:
    """Check the WEBP marker beyond its RIFF prefix."""
    return mime != "image/webp" or len(data) >= 12 and data[8:12] == b"WEBP"


def _validate_data_uri(value: str) -> tuple[str, int]:
    """Accept only size-bounded base64 raster data URIs."""
    match = re.fullmatch(r"data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)", value)
    if match is None:
        raise SupportValidationError("image data URI must contain a supported raster type")
    try:
        data = base64.b64decode(match.group(2), validate=True)
    except binascii.Error as error:
        raise SupportValidationError("image data URI must contain valid base64") from error
    if len(data) > MAX_IMAGE_BYTES:
        raise SupportValidationError("support image is too large")
    mime = match.group(1)
    if not any(data.startswith(signature) for signature in MIME_SIGNATURES[mime]) or not _valid_webp(data, mime):
        raise SupportValidationError("image data URI content does not match its raster type")
    return value, len(data)


def _consume_image_budget(uri: str, size: int, context: _PreparationContext) -> str:
    """Charge an image to the aggregate decoded-byte budget."""
    if size > context.remaining_image_bytes:
        raise SupportValidationError("support images exceed the aggregate size budget")
    context.remaining_image_bytes -= size
    return uri


def _mark_image_origin(asset: dict[str, Any]) -> None:
    """Validate source/generated origin and mark generated imagery explicitly."""
    meta = asset["meta"]
    if meta.get("origin") not in {"source", "generated"}:
        raise SupportValidationError("image meta.origin must be 'source' or 'generated'")
    if "rights" in meta:
        _validate_rights(meta["rights"])
    if meta["origin"] == "generated":
        meta["ai_disclaimer"] = AI_IMAGE_NOTICE
