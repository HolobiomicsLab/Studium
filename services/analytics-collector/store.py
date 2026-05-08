"""JSONL append-only event store, partitioned by course token + UTC date."""

import os
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel


def _data_dir() -> Path:
    return Path(os.environ.get("ANALYTICS_DATA_DIR", "data"))


def append_events(course_token: str, events: list[BaseModel]) -> int:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    target = _data_dir() / course_token / f"{today}.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as f:
        for ev in events:
            f.write(ev.model_dump_json() + "\n")
    return len(events)
