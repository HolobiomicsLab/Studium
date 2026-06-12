"""loader.py — plug-in seam for real KT datasets (EdNet / ASSISTments / ...).

The harness defaults to synthetic data; to run an EXTERNAL benchmark, point this
loader at a real interaction-log CSV.

Expected canonical schema (one row per attempt):
    student  : learner id (string)
    skill    : skill / KC id (string)
    correct  : 0 or 1 outcome
    order    : sortable key giving chronological order WITHIN a (student, skill)
               stream (e.g. a timestamp or an attempt index)

Real datasets use different column names; pass a ``cols`` mapping from the
canonical name to the source column, e.g. for EdNet-style logs::

    load_interactions_csv(
        "ednet.csv",
        cols={"student": "user_id", "skill": "skill_id",
              "correct": "is_correct", "order": "ts"},
    )

``order`` is parsed as int when possible, else kept as the raw string (so ISO
timestamps still sort lexically). ``correct`` is coerced to ``int`` in {0, 1}.
No dataset is shipped with the harness — synthetic remains the default source.
"""

from __future__ import annotations

import csv
from typing import Dict, List, Optional

DEFAULT_COLS = {
    "student": "student",
    "skill": "skill",
    "correct": "correct",
    "order": "order",
}


def _coerce_correct(value: str) -> int:
    v = value.strip().lower()
    if v in ("1", "true", "t", "yes", "y", "correct"):
        return 1
    if v in ("0", "false", "f", "no", "n", "incorrect", "wrong"):
        return 0
    # numeric fallback (e.g. "1.0")
    try:
        return 1 if float(v) >= 0.5 else 0
    except ValueError as exc:  # pragma: no cover - defensive
        raise ValueError(f"cannot interpret correct value {value!r}") from exc


def _coerce_order(value: str):
    v = value.strip()
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v  # keep raw (e.g. ISO timestamp string)


def load_interactions_csv(
    path: str,
    cols: Optional[Dict[str, str]] = None,
) -> List[Dict]:
    """Load a real KT interaction CSV into the canonical record list.

    Args:
        path: path to the CSV file (with a header row).
        cols: optional mapping {canonical_name -> source_column}. Defaults to
            identity (columns already named student/skill/correct/order).

    Returns:
        List of ``{student, skill, correct, order}`` dicts in file order.
    """
    mapping = dict(DEFAULT_COLS)
    if cols:
        mapping.update(cols)

    rows: List[Dict] = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [
            src
            for src in mapping.values()
            if reader.fieldnames is None or src not in reader.fieldnames
        ]
        if missing:
            raise ValueError(
                f"CSV {path} is missing expected column(s): {missing}; "
                f"header was {reader.fieldnames}"
            )
        for raw in reader:
            rows.append(
                {
                    "student": str(raw[mapping["student"]]),
                    "skill": str(raw[mapping["skill"]]),
                    "correct": _coerce_correct(raw[mapping["correct"]]),
                    "order": _coerce_order(raw[mapping["order"]]),
                }
            )
    return rows
