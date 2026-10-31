"""Tiny on-disk JSON cache for Perspicacité .search responses (reproducible re-gen)."""
from __future__ import annotations
import hashlib, json, os
from pathlib import Path

# Old normalized responses lost live-flat passage text and DOI.
NORMALIZATION_CACHE_VERSION = 2


def _enabled() -> bool:
    return os.getenv("STUDIUM_PERSPICACITE_CACHE", "on") != "off"


def _dir() -> Path:
    return Path(os.getenv("STUDIUM_PERSPICACITE_CACHE_DIR", ".cache/perspicacite"))


def _key(kb_names: list[str], query: str, k: int) -> str:
    raw = json.dumps({"kb": sorted(kb_names), "q": query, "k": k,
                      "normalization": NORMALIZATION_CACHE_VERSION}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def get(kb_names: list[str], query: str, k: int) -> dict | None:
    if not _enabled():
        return None
    f = _dir() / f"{_key(kb_names, query, k)}.json"
    try:
        return json.loads(f.read_text()) if f.exists() else None
    except (OSError, ValueError):
        return None


def put(kb_names: list[str], query: str, k: int, value: dict) -> None:
    if not _enabled():
        return
    d = _dir()
    try:
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{_key(kb_names, query, k)}.json").write_text(json.dumps(value))
    except OSError:
        pass
