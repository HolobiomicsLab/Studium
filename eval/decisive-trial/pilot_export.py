"""Project consented `ai_audit_result` telemetry into a per-learner study table for the
decisive trial (PREREGISTRATION.md). The trial has not run; this is the export harness the
trio fills with real pilot/cohort data. It aggregates only the FROZEN transfer-test scenes
into one row per learner, with the primary endpoint (judgment-transfer score) and the
over-distrust check, keyed by the consented pseudonym. Stdlib only; no runtime coupling."""
from __future__ import annotations

import csv
import json
from collections import defaultdict

_PSEUDO_KEYS = ("pseudonyme", "pseudonym", "pseudonyme_hash")
_COLUMNS = ["pseudonym", "arm", "judgment_transfer_score", "planted", "hits", "misses", "false_alarms"]


def _pseudonym(event: dict) -> str | None:
    for key in _PSEUDO_KEYS:
        if event.get(key):
            return event[key]
    return None


def build_study_table(events: list[dict], arm_by_pseudonym: dict[str, str], transfer_scene_ids) -> dict:
    """One row per learner aggregating the FROZEN transfer-test `ai_audit_result` events.

    judgment_transfer_score = hits / (hits + misses) over transfer scenes (the primary
    endpoint proxy). Learners with no transfer trial or no arm assignment are skipped and
    returned under 'skipped' (never silently dropped). Pure."""
    transfer = set(transfer_scene_ids)
    agg: dict[str, dict] = defaultdict(lambda: {"tp": 0, "missed": 0, "fp": 0, "planted": 0})
    for event in events:
        if event.get("type") != "ai_audit_result" or event.get("scene_id") not in transfer:
            continue
        pseudonym = _pseudonym(event)
        if pseudonym is None:
            continue
        cell = agg[pseudonym]
        cell["tp"] += int(event.get("true_positives", 0))
        cell["missed"] += int(event.get("missed", 0))
        cell["fp"] += int(event.get("false_positives", 0))
        cell["planted"] += int(event.get("planted_errors", 0))

    rows, skipped = [], []
    for pseudonym, cell in sorted(agg.items()):
        arm = arm_by_pseudonym.get(pseudonym)
        signal_trials = cell["tp"] + cell["missed"]
        if arm is None or signal_trials == 0:
            skipped.append(pseudonym)
            continue
        rows.append({
            "pseudonym": pseudonym, "arm": arm,
            "judgment_transfer_score": round(cell["tp"] / signal_trials, 4),
            "planted": cell["planted"], "hits": cell["tp"], "misses": cell["missed"],
            "false_alarms": cell["fp"],
        })
    return {"rows": rows, "skipped": skipped}


def write_csv(rows: list[dict], path: str) -> None:
    """Write the study table to CSV with the fixed column order."""
    with open(path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=_COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def load_events(jsonl_path: str) -> list[dict]:
    """Load a telemetry JSONL file, skipping unparseable lines."""
    events: list[dict] = []
    with open(jsonl_path) as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


if __name__ == "__main__":
    demo = [
        {"type": "ai_audit_result", "scene_id": "transfer_1", "pseudonyme": "A", "true_positives": 2, "missed": 0, "false_positives": 0, "planted_errors": 2},
        {"type": "ai_audit_result", "scene_id": "transfer_1", "pseudonyme": "B", "true_positives": 0, "missed": 2, "false_positives": 1, "planted_errors": 2},
        {"type": "ai_audit_result", "scene_id": "practice_1", "pseudonyme": "A", "true_positives": 1, "missed": 1, "false_positives": 0, "planted_errors": 2},
    ]
    out = build_study_table(demo, {"A": "treatment", "B": "control"}, {"transfer_1"})
    assert len(out["rows"]) == 2 and out["rows"][0]["judgment_transfer_score"] == 1.0
    print("ok", out["rows"])
