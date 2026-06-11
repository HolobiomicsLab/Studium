"""Corpus manifest loading.

The corpus bodies and manifest live under eval/corpus/ which is gitignored
(third-party OER material). The harness reads them locally and NEVER copies the
raw body into a committed artifact.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .paths import CORPUS_MANIFEST, REPO_ROOT


@dataclass(frozen=True)
class CorpusMaterial:
    id: str
    title: str
    discipline: str
    branch: str
    level: str
    local_path: Path
    word_count: int
    summary: str
    license: str
    source_url: str

    def read_body(self) -> str:
        if not self.local_path.exists():
            raise FileNotFoundError(
                f"corpus body not found: {self.local_path} "
                f"(eval/corpus/ is gitignored — re-fetch from manifest.json source_url)"
            )
        return self.local_path.read_text(encoding="utf-8")


def load_manifest() -> list[CorpusMaterial]:
    if not CORPUS_MANIFEST.exists():
        raise FileNotFoundError(
            f"corpus manifest not found at {CORPUS_MANIFEST}. "
            "The corpus is gitignored; populate eval/corpus/ locally."
        )
    raw = json.loads(CORPUS_MANIFEST.read_text(encoding="utf-8"))
    out: list[CorpusMaterial] = []
    for entry in raw:
        out.append(
            CorpusMaterial(
                id=str(entry["id"]),
                title=entry["title"],
                discipline=entry.get("discipline", "general"),
                branch=entry.get("branch", "sciences"),
                level=entry.get("level", "undergraduate"),
                local_path=(REPO_ROOT / entry["local_path"]).resolve(),
                word_count=int(entry.get("word_count", 0)),
                summary=entry.get("summary", ""),
                license=entry.get("license", ""),
                source_url=entry.get("source_url", ""),
            )
        )
    return out


def get_material(corpus_id: str) -> CorpusMaterial:
    for m in load_manifest():
        if m.id == corpus_id:
            return m
    ids = ", ".join(m.id for m in load_manifest())
    raise KeyError(f"corpus id {corpus_id!r} not in manifest (have: {ids})")
