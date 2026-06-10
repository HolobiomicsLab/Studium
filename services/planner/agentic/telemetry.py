"""Append-only JSONL telemetry (ASB pattern) + in-memory double for tests."""
from __future__ import annotations
import json
import os
from typing import Any


class InMemoryTelemetrySink:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def emit(self, record: dict[str, Any]) -> None:
        self.records.append(record)


class JsonlTelemetrySink:
    def __init__(self, path: str) -> None:
        self._path = path

    def emit(self, record: dict[str, Any]) -> None:
        parent = os.path.dirname(self._path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(self._path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
