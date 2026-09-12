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
SUPPORTED_KINDS = {"image", "equation_latex", "code", "mol_3d"}
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
MAX_PAYLOAD_CHARS = 64 * 1024
MAX_SIDECAR_BYTES = 1024 * 1024
MAX_ASSETS = 64
AI_IMAGE_NOTICE = "AI-generated image; details may be inaccurate."
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
    elif kind == "equation_latex":
        _require_inline_payload(asset)
    elif kind == "code":
        _validate_mermaid(asset)
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
    if meta["origin"] == "generated":
        meta["ai_disclaimer"] = AI_IMAGE_NOTICE
