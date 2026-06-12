"""fetch_assistments.py — fetch + preprocess a REAL KT benchmark for EV-4.

Downloads the canonical *preprocessed* ASSISTments 2009 skill-builder logs and
rewrites them into the loader's canonical schema (student/skill/correct/order)
so `run_calibration.py --csv` can produce the **external** Brier/AUC number for
the Beta learner model (ADR 004) vs BKT / RunningMean.

Source (tab-separated `user_id item_id timestamp correct skill_id`):
    https://github.com/theophilee/learner-performance-prediction
    (Choffin et al., "Best Practices for KT" — a standard public KT benchmark)

The dataset is NOT shipped with the harness (see loader.py). This script fetches
it on demand into `data/` (gitignored). Reproduce the external number with::

    python eval/validity/kt_calibration/fetch_assistments.py
    python eval/validity/kt_calibration/run_calibration.py \
        --csv eval/validity/kt_calibration/data/assistments09_canonical.csv

`--from-file PATH` preprocesses an already-downloaded copy (offline / CI).
Rows preserve file order, which the source has already sorted chronologically
per student — the replay protocol relies on within-(student,skill) order.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from typing import Dict, Iterable, List, Optional

SOURCE_URL = (
    "https://raw.githubusercontent.com/theophilee/"
    "learner-performance-prediction/master/data/assistments09/preprocessed_data.csv"
)

# source column -> canonical column
SOURCE_COLS = {"student": "user_id", "skill": "skill_id", "correct": "correct"}
CANONICAL_FIELDS = ["student", "skill", "correct", "order"]


def _valid_skill(raw: str) -> bool:
    """Drop rows with a missing/placeholder skill id (empty, NaN, negative)."""
    v = (raw or "").strip()
    if not v or v.lower() in ("nan", "none", "null"):
        return False
    try:
        return int(float(v)) >= 0
    except ValueError:
        return True  # non-numeric skill ids are kept as-is


def preprocess_rows(rows: Iterable[Dict[str, str]]) -> List[Dict]:
    """Map source rows to canonical records, preserving order, filtering bad skills.

    ``order`` is a global incrementing index so the canonical CSV replays in the
    exact source order (the source is chronologically sorted per student).
    """
    out: List[Dict] = []
    idx = 0
    for raw in rows:
        skill = raw.get(SOURCE_COLS["skill"], "")
        if not _valid_skill(skill):
            continue
        try:
            correct = int(float(str(raw.get(SOURCE_COLS["correct"], "0")).strip()))
        except ValueError:
            continue
        out.append(
            {
                "student": str(raw[SOURCE_COLS["student"]]).strip(),
                "skill": str(skill).strip(),
                "correct": 1 if correct >= 1 else 0,
                "order": idx,
            }
        )
        idx += 1
    return out


def _read_source(path: str) -> List[Dict[str, str]]:
    """Read the source file, sniffing tab vs comma delimiter."""
    with open(path, newline="", encoding="utf-8") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        delim = "\t" if sample.count("\t") >= sample.count(",") else ","
        return list(csv.DictReader(fh, delimiter=delim))


def write_canonical(records: List[Dict], out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CANONICAL_FIELDS)
        writer.writeheader()
        writer.writerows(records)


def _download(url: str, dest: str) -> None:
    import urllib.request

    print(f"Downloading {url} ...", flush=True)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    urllib.request.urlretrieve(url, dest)  # noqa: S310 - fixed trusted URL
    print(f"  -> {dest} ({os.path.getsize(dest)} bytes)", flush=True)


def main(argv: Optional[List[str]] = None) -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(here, "data")
    parser = argparse.ArgumentParser(description="fetch+preprocess ASSISTments for EV-4")
    parser.add_argument(
        "--from-file", default=None, help="preprocess an already-downloaded source file"
    )
    parser.add_argument(
        "--out",
        default=os.path.join(data_dir, "assistments09_canonical.csv"),
        help="canonical CSV output path",
    )
    args = parser.parse_args(argv)

    src_path = args.from_file
    if not src_path:
        src_path = os.path.join(data_dir, "assistments09_source.csv")
        if not os.path.isfile(src_path):
            _download(SOURCE_URL, src_path)

    rows = _read_source(src_path)
    records = preprocess_rows(rows)
    if not records:
        print("No valid interactions after preprocessing.", file=sys.stderr)
        return 1
    write_canonical(records, args.out)

    students = len({r["student"] for r in records})
    skills = len({r["skill"] for r in records})
    pos = sum(r["correct"] for r in records)
    print(
        f"Wrote {len(records)} interactions "
        f"({students} students, {skills} skills, {pos / len(records):.3f} p(correct)) "
        f"-> {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
