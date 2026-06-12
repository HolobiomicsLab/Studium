"""fetch_assistments.py — fetch + preprocess REAL KT benchmarks for EV-4.

Downloads a canonical *preprocessed* KT benchmark (default ASSISTments 2009;
``--dataset`` selects others) and rewrites it into the loader's canonical schema
(student/skill/correct/order) so ``run_calibration.py --csv`` can produce the
**external** Brier/AUC number for the Beta learner model (ADR 004) vs BKT /
RunningMean.

Source (tab-separated `user_id item_id timestamp correct skill_id`):
    https://github.com/theophilee/learner-performance-prediction
    (Choffin et al., "Best Practices for KT" — a standard public KT benchmark
    collection: assistments09/12/15/17, bridge_algebra06, spanish, statics)

Datasets are NOT shipped with the harness (see loader.py). This script fetches
them on demand into `data/` (gitignored). Reproduce the external numbers with::

    python eval/validity/kt_calibration/fetch_assistments.py                    # assistments09
    python eval/validity/kt_calibration/fetch_assistments.py --dataset spanish  # generality
    python eval/validity/kt_calibration/run_calibration.py \
        --csv eval/validity/kt_calibration/data/assistments09_canonical.csv

See `external_result.json` for the committed multi-dataset numbers. `--from-file
PATH` preprocesses an already-downloaded copy (offline / CI). Rows preserve file
order, which the source has already sorted chronologically per student — the
replay protocol relies on within-(student,skill) order.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from typing import Dict, Iterable, List, Optional

SOURCE_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/theophilee/"
    "learner-performance-prediction/master/data/{dataset}/preprocessed_data.csv"
)
# Datasets in the benchmark repo sharing the user_id/item_id/timestamp/correct/skill_id schema.
KNOWN_DATASETS = (
    "assistments09",
    "assistments12",
    "assistments15",
    "assistments17",
    "bridge_algebra06",
    "spanish",
    "statics",
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
    parser = argparse.ArgumentParser(description="fetch+preprocess a KT benchmark for EV-4")
    parser.add_argument(
        "--dataset",
        default="assistments09",
        help=f"benchmark dataset name (known: {', '.join(KNOWN_DATASETS)})",
    )
    parser.add_argument(
        "--from-file", default=None, help="preprocess an already-downloaded source file"
    )
    parser.add_argument(
        "--out",
        default=None,
        help="canonical CSV output path (default: data/<dataset>_canonical.csv)",
    )
    args = parser.parse_args(argv)

    out_path = args.out or os.path.join(data_dir, f"{args.dataset}_canonical.csv")
    src_path = args.from_file
    if not src_path:
        src_path = os.path.join(data_dir, f"{args.dataset}_source.csv")
        if not os.path.isfile(src_path):
            _download(SOURCE_URL_TEMPLATE.format(dataset=args.dataset), src_path)

    rows = _read_source(src_path)
    records = preprocess_rows(rows)
    if not records:
        print("No valid interactions after preprocessing.", file=sys.stderr)
        return 1
    write_canonical(records, out_path)

    students = len({r["student"] for r in records})
    skills = len({r["skill"] for r in records})
    pos = sum(r["correct"] for r in records)
    print(
        f"Wrote {len(records)} interactions "
        f"({students} students, {skills} skills, {pos / len(records):.3f} p(correct)) "
        f"-> {out_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
