"""Strict normalization for captured Perspicacité passage envelopes."""
from __future__ import annotations

import hashlib
import json
from typing import Any


class PassageEnvelopeError(ValueError):
    """Raised when a successful passage response has an unusable shape."""


def _optional_text(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise PassageEnvelopeError(f"{field} must be a string or null")
    return value or None


def _authors(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise PassageEnvelopeError("source.authors must be a list of strings")
    return value


def _score(value: Any) -> float | None:
    if value is None:
        return None
    try:
        score = float(value or 0.0)
    except (TypeError, ValueError) as exc:
        raise PassageEnvelopeError("passage score must be numeric") from exc
    if not 0.0 <= score <= 1.0:
        raise PassageEnvelopeError("passage score must be between 0 and 1")
    return score


def _year(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise PassageEnvelopeError("source.year must be an integer or null")
    return value


def _passage_hash(passage: dict[str, Any]) -> str:
    encoded = json.dumps(passage, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _normalize_hit(hit: Any) -> dict[str, Any]:
    if not isinstance(hit, dict):
        raise PassageEnvelopeError("each passage must be an object")
    source = hit.get("source") or {}
    if not isinstance(source, dict):
        raise PassageEnvelopeError("passage source must be an object")
    text = hit.get("text") if "text" in hit else hit.get("chunk_text")
    if not isinstance(text, str) or not text:
        raise PassageEnvelopeError("each passage must contain non-empty text")
    normalized = {
        "id": _optional_text(source.get("bibkey"), "source.bibkey")
        or _optional_text(hit.get("chunk_id"), "chunk_id"),
        "text": text,
        "score": _score(hit.get("score")),
        "doi": _optional_text(hit.get("source_doi", source.get("doi")), "source_doi"),
        "url": _optional_text(hit.get("source_url", source.get("url")), "source_url"),
        "license_id": _optional_text(
            hit.get("license_id", source.get("license")), "license_id"
        ),
        "kb_name": _optional_text(hit.get("kb_name"), "kb_name"),
        "title": _optional_text(hit.get("title", source.get("title")), "source.title"),
        "authors": _authors(hit.get("authors", source.get("authors"))),
        "year": _year(hit.get("year", source.get("year"))),
    }
    normalized["sha256"] = _passage_hash(normalized)
    normalized["id"] = normalized["id"] or normalized["doi"] or normalized["url"]
    normalized["id"] = normalized["id"] or f"sha256:{normalized['sha256']}"
    return normalized


def normalize_passage_envelope(payload: Any) -> dict[str, Any]:
    """Normalize live flat and legacy nested Perspicacité passage responses.

    Failed retrievals retain an explicit offline status. A response that claims
    success but lacks a valid passage collection raises ``PassageEnvelopeError``.
    """
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return {
            "status": "offline",
            "passages": [],
            "attempts": [],
            "refined_query": None,
            "origin": None,
        }
    collection_key = "results" if "results" in payload else "passages"
    if collection_key not in payload or not isinstance(payload[collection_key], list):
        raise PassageEnvelopeError("successful response must contain a passage list")
    passages = [_normalize_hit(hit) for hit in payload[collection_key]]
    return {
        "status": "ok",
        "passages": passages,
        "attempts": payload.get("attempts") or [],
        "refined_query": payload.get("refined_query"),
        "origin": payload.get("origin"),
    }
