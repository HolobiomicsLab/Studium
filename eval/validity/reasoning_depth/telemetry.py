"""telemetry.py — read reasoning_signal + tutor_move events from a run dir. Pure stdlib."""
from __future__ import annotations

import glob
import json
import os
from typing import Dict, List


def read_events(run_dir: str) -> List[Dict]:
    """All JSON events across <run_dir>/sessions/*/telemetry.jsonl (file order). Defensive."""
    out: List[Dict] = []
    pattern = os.path.join(run_dir, "sessions", "*", "telemetry.jsonl")
    for path in sorted(glob.glob(pattern)):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(obj, dict):
                        out.append(obj)
        except OSError:
            continue
    return out


def events_of_type(events: List[Dict], type_name: str) -> List[Dict]:
    return [e for e in events if e.get("type") == type_name]
