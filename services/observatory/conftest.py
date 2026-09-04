"""Fixtures for the Observatory tests (INT-STUDIUM-008, slice 1).

Every fixture builds its artifacts with the REAL emitters — the planner's ASTRA writers,
the scene judge, the harness auditor and report writer — so a change in what Studium
writes fails these tests instead of silently drifting from the Observatory's readers.

This file sits at the service root so pytest loads it for `tests/` and puts the flat
`observatory_*` modules on sys.path (rule 004 of the repo: services use flat modules).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parents[1]
for _p in (
    SERVICE_DIR,
    REPO_ROOT / "services" / "planner",
    REPO_ROOT / "services" / "planner" / "tests",  # astra_course_fixture
    REPO_ROOT / "eval",
    REPO_ROOT / "tools",
):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

BROKEN_YAML = "id: [unclosed"
#: Values that must never reach a view: a pseudonym and two free-text fields.
PSEUDONYMS = ("pseudo-proficient", "pseudo-struggling")
FREE_TEXT = ("SECRET-FREE-TEXT-7f3a", "SECRET-PAYLOAD-9c1b")
RUN_ID = "01-deterministic-20260615-120000"


def _audit_helpers():
    """`eval/tests/test_audit.py` loaded by path: importing it under a module name
    collides with `services/planner/tests` when both suites run together (the pattern
    `tools/test_astra_render.py` uses)."""
    spec = importlib.util.spec_from_file_location(
        "observatory_audit_fixtures", REPO_ROOT / "eval" / "tests" / "test_audit.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _synthetic_run(run_dir: Path) -> None:
    """One evaluation run in the real shape: bundle, two persona sessions, provenance,
    then the real `run_audit` and `write_report`. The telemetry carries a pseudonym and
    a free-text field on purpose — the privacy tests assert they never leave the disk."""
    from harness.audit import run_audit
    from harness.report import write_report

    helpers = _audit_helpers()
    run_dir.mkdir(parents=True, exist_ok=True)
    helpers._write_bundle(run_dir, with_lwg=True, grounded=True)
    helpers._write_persona(run_dir, "proficient", ["next", "complete"], [])
    helpers._write_persona(run_dir, "struggling", ["next"] * 60, ["r1"])  # 60 = the turn cap
    helpers._provenance(run_dir)
    write_report(run_audit(run_dir), run_dir)

    sessions = run_dir / "sessions" / "proficient"
    events = [
        {"type": "scene_entered", "client_timestamp": "2026-06-15T12:00:00Z",
         "learner_pseudonym": "pseudo-proficient"},
        {"type": "critique_submitted", "client_timestamp": "2026-06-15T12:05:00Z",
         "text": "SECRET-FREE-TEXT-7f3a"},
    ]
    telemetry = sessions / "telemetry.jsonl"
    telemetry.write_text(
        telemetry.read_text(encoding="utf-8").rstrip("\n")
        + "".join(f"\n{json.dumps(e)}" for e in events) + "\n", encoding="utf-8")
    (sessions / "events.jsonl").write_text(
        json.dumps({"event_type": "x", "payload": {"text": "SECRET-PAYLOAD-9c1b"}}) + "\n",
        encoding="utf-8")


@pytest.fixture
def course_root(tmp_path: Path) -> Path:
    """Two emitted courses: `course-a` complete with a review, `course-b` without a
    review and with one unreadable universe file."""
    from astra_course_fixture import build_course_set, build_review_set

    root = tmp_path / "courses"
    complete = root / "course-a"
    complete.mkdir(parents=True)
    build_course_set(complete)
    build_review_set(complete)

    partial = root / "course-b"
    partial.mkdir(parents=True)
    build_course_set(partial)
    (partial / "universes" / "broken.yaml").write_text(BROKEN_YAML, encoding="utf-8")
    return root


@pytest.fixture
def eval_root(tmp_path: Path) -> Path:
    root = tmp_path / "reports"
    _synthetic_run(root / RUN_ID)
    return root


@pytest.fixture
def validity_root(tmp_path: Path) -> Path:
    root = tmp_path / "validity"
    with_result = root / "suite_with_result"
    (with_result / "reports").mkdir(parents=True)
    (with_result / "README.md").write_text("# EV-1 — Suite with result\n\nbody\n", encoding="utf-8")
    (with_result / "external_result.json").write_text(
        json.dumps({"n": 12, "qwk": 0.71, "ok": True, "nested": {"a": 1}}), encoding="utf-8")
    (with_result / "reports" / "2026.json").write_text(json.dumps({"score": 0.5}), encoding="utf-8")

    empty = root / "suite_empty"
    empty.mkdir(parents=True)
    (empty / "README.md").write_text("# EV-2 — Suite without result\n", encoding="utf-8")
    return root


@pytest.fixture
def cfg(course_root: Path, eval_root: Path, validity_root: Path):
    from observatory_config import ObservatoryConfig

    return ObservatoryConfig(course_root=course_root, courses=(), eval_root=eval_root,
                             validity_root=validity_root)
