"""Pure aggregation functions over JSONL telemetry store.

All functions are read-only — they iterate JSONL files in `data_dir/<course>/`
and compute on the fly. No pre-aggregation, no caching: simplicity first
(ACD §4.3 §3.1).
"""

import json
from collections import defaultdict
from pathlib import Path
from typing import Iterator


def _iter_events(data_dir: Path, course: str) -> Iterator[dict]:
    """Yield JSON-decoded events from all JSONL files in data_dir/course/."""
    course_dir = data_dir / course
    if not course_dir.exists():
        return
    for f in sorted(course_dir.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def compute_progress(data_dir: Path, course: str) -> dict:
    """Completion rate by scene_id, with n_learners (distinct pseudonyms)."""
    completions: dict[str, list[bool]] = defaultdict(list)
    learners: dict[str, set[str]] = defaultdict(set)
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "scene_completed":
            continue
        sid = ev.get("scene_id")
        if sid is None:
            continue
        completions[sid].append(bool(ev.get("success", False)))
        pseudo = ev.get("learner_pseudonym")
        if pseudo:
            learners[sid].add(pseudo)
    return {
        "scenes": {
            sid: {
                "completion_rate": sum(1 for s in vals if s) / len(vals) if vals else 0.0,
                "n_learners": len(learners[sid]),
            }
            for sid, vals in completions.items()
        }
    }


def compute_calibration(data_dir: Path, course: str, learner: str | None = None) -> dict:
    """Brier score on quiz_answered events.

    Brier = mean((confidence - outcome)^2) where outcome = 1.0 if correct else 0.0.
    Lower is better-calibrated.
    """
    items = []
    for ev in _iter_events(data_dir, course):
        if ev.get("type") != "quiz_answered":
            continue
        if learner is not None and ev.get("learner_pseudonym") != learner:
            continue
        confidence = ev.get("confidence")
        correct = ev.get("correct")
        if confidence is None or correct is None:
            continue
        outcome = 1.0 if correct else 0.0
        items.append((float(confidence), outcome))
    if not items:
        return {"brier_score": None, "n_items": 0}
    brier = sum((c - o) ** 2 for c, o in items) / len(items)
    return {"brier_score": brier, "n_items": len(items)}


def compute_autonomy(data_dir: Path, course: str) -> dict:
    """Anti-offloading metrics: autonomy_ratio + critique_completion_rate.

    - autonomy_ratio = n_critique_submitted / (n_critique_submitted + n_hints_applied)
    - critique_completion_rate = mean(completion_rate of critique_submitted events)
    """
    n_critique = 0
    sum_completion = 0.0
    n_hints = 0
    for ev in _iter_events(data_dir, course):
        t = ev.get("type")
        if t == "critique_submitted":
            n_critique += 1
            sum_completion += float(ev.get("completion_rate", 0))
        elif t == "adaptation_applied" and ev.get("signal") == "hint":
            n_hints += 1
    total = n_critique + n_hints
    return {
        "critique_completion_rate": (sum_completion / n_critique) if n_critique else 0.0,
        "autonomy_ratio": (n_critique / total) if total else 0.0,
        "n_critique": n_critique,
        "n_hints": n_hints,
    }
