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
    REPO_ROOT / "services" / "analytics-collector",  # store.py: the collector's own writer
):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

BROKEN_YAML = "id: [unclosed"
#: Values that must never reach a view: two pseudonyms and three free-text fields.
#: `SECRET-PRE-REPORT-4d2e` is planted before the audit and the report run, so the
#: crawl covers `report.md` — the one artifact a page renders whole. The other two
#: are written afterwards and so exercise the direct telemetry readers only.
PSEUDONYMS = ("pseudo-proficient", "pseudo-struggling")
FREE_TEXT = ("SECRET-FREE-TEXT-7f3a", "SECRET-PAYLOAD-9c1b", "SECRET-PRE-REPORT-4d2e")
RUN_ID = "01-deterministic-20260615-120000"

#: The collector partitions its store by course token, and the token *is* the course id
#: (INT-STUDIUM-019), so the store's partition is named after the emitted course.
STORE_COURSE = "course-a"
#: One lesson, on every event of every stream. `learner_pseudonym` is HMAC(learnerId:lessonId):
#: it identifies a person WITHIN one lesson and is not a cross-lesson person id, so a fixture
#: that reused a pseudonym across lessons would assert an identity the runtime never emits.
STORE_LESSON = "demo-metabolomics-001"
STORE_BUNDLE_VERSION = f"1.1:{STORE_LESSON}@2026-09-01T10:00:00Z"
#: Six learners: above `MIN_LEARNERS_DEFAULT` (5), so the k floor does not suppress.
STORE_PSEUDONYMS = tuple(f"pseudo-store-{i}" for i in range(6))
#: Two of them: a cohort below the floor.
SMALL_COHORT_PSEUDONYMS = STORE_PSEUDONYMS[:2]


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
    free-text fields on purpose, one of them planted before the report so `report.md`
    is on the crawl's path — the privacy tests assert they never leave the disk."""
    from harness.audit import run_audit
    from harness.report import write_report

    helpers = _audit_helpers()
    run_dir.mkdir(parents=True, exist_ok=True)
    helpers._write_bundle(run_dir, with_lwg=True, grounded=True)
    helpers._write_persona(run_dir, "proficient", ["next", "complete"], [])
    helpers._write_persona(run_dir, "struggling", ["next"] * 60, ["r1"])  # 60 = the turn cap
    helpers._provenance(run_dir)

    # Planted before the audit and the report. `report.md` is the one artifact the run
    # page renders verbatim (`templates/run.html`) and the API twin returns whole, so a
    # secret written only after `write_report` leaves that path unasserted. Its own
    # event type and no `client_timestamp`, so the persona counts and span are unchanged.
    probe = run_dir / "sessions" / "proficient" / "telemetry.jsonl"
    probe.write_text(
        probe.read_text(encoding="utf-8").rstrip("\n") + "\n"
        + json.dumps({"type": "free_text_probe", "text": "SECRET-PRE-REPORT-4d2e"}) + "\n",
        encoding="utf-8")
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


def session_events(pseudonym: str, index: int, *, lesson_id: str = STORE_LESSON,
                   bundle_version: str = STORE_BUNDLE_VERSION, audit: bool = True,
                   critique_scene_type: str | None = "spot_the_flaw") -> list:
    """One learner's lesson, as the runtime's ADR-006 events.

    Built from the Pydantic mirror the collector validates against, so an event-schema
    change fails these fixtures instead of drifting silently past the readers they feed.
    Deterministic in `pseudonym` and `index`, which is what lets the same list be written
    into both layouts: agreement between the two columns is then the default, and a test
    that wants a divergence has to cause one.

    The keyword arguments exist for the privacy regressions of slice 2: `lesson_id` because
    a pseudonym is `HMAC(learnerId:lessonId)` and a cohort therefore lives inside one
    lesson; `bundle_version` because a comparison needs one identical artifact scope on
    both sides; `audit` and `critique_scene_type` because a populated lesson can still have
    a single contributor to one metric family.
    """
    from telemetry_events import (
        AIAuditResult, AdaptationApplied, CritiqueSubmitted, LessonCompleted, LessonStarted,
        QuizAnswered, SceneCompleted, SceneEntered,
    )

    def base(n: int) -> dict:
        return {"event_id": f"{pseudonym}-{lesson_id}-{n:02d}", "learner_pseudonym": pseudonym,
                "lesson_id": lesson_id, "bundle_version": bundle_version,
                "client_timestamp": f"2026-09-05T10:{index % 60:02d}:{n:02d}Z"}

    correct = index % 2 == 0
    events = [
        LessonStarted(**base(1), type="lesson_started",
                      bundle_uri=f"file:///bundles/{lesson_id}.zip"),
        SceneEntered(**base(2), type="scene_entered", scene_id="s1-quiz", scene_type="quiz"),
        QuizAnswered(**base(3), type="quiz_answered", scene_id="s1-quiz", item_id="q1",
                     correct=correct, response_time_ms=18_000, confidence=0.8),
        SceneCompleted(**base(4), type="scene_completed", scene_id="s1-quiz",
                       duration_ms=42_000, success=correct),
        AdaptationApplied(**base(5), type="adaptation_applied", rule_id="hint_after_error",
                          signal="hint", modulator="scaffolding", value=1.0),
        SceneEntered(**base(6), type="scene_entered", scene_id="s2-audit",
                     scene_type="spot_the_flaw"),
    ]
    if audit:
        # Grounded audit: `planted_errors` and `sound_total` are both non-zero, so both
        # directions of the trust gap are measured on both sides of the pair.
        events.append(AIAuditResult(**base(7), type="ai_audit_result", scene_id="s2-audit",
                                    planted_errors=3, true_positives=2, false_positives=1,
                                    missed=1, sound_total=4))
    if critique_scene_type is not None:
        events.append(CritiqueSubmitted(**base(8), type="critique_submitted", scene_id="s2-audit",
                                        llm_score=0.72, completion_rate=0.9,
                                        scene_type=critique_scene_type))
    events += [
        SceneCompleted(**base(9), type="scene_completed", scene_id="s2-audit",
                       duration_ms=61_000, success=True),
        LessonCompleted(**base(10), type="lesson_completed", total_duration_ms=180_000,
                        autonomy_ratio=0.5),
    ]
    return events


def write_store(root: Path, events: list, *, course: str = STORE_COURSE) -> Path:
    """Append `events` through the collector's own `store.append_events`, so the layout
    under test (`<store>/<course>/<YYYY-MM-DD>.jsonl`) is the collector's and not a third
    copy of it."""
    import store

    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("ANALYTICS_DATA_DIR", str(root))
        store.append_events(course, events)
    return root


def write_stream(root: Path, segments: tuple[str, ...], events: list) -> Path:
    """One `telemetry.jsonl` at `root/<segments>/telemetry.jsonl` — the durable MCP-host
    layout, whose top level is a pseudonym and whose second is a bundle id."""
    stream = root.joinpath(*segments) / "telemetry.jsonl"
    stream.parent.mkdir(parents=True, exist_ok=True)
    stream.write_text("".join(f"{event.model_dump_json()}\n" for event in events),
                      encoding="utf-8")
    return stream


def _write_store(root: Path, pseudonyms: tuple[str, ...]) -> Path:
    for index, pseudonym in enumerate(pseudonyms):
        write_store(root, session_events(pseudonym, index))
    return root


@pytest.fixture
def analytics_store(tmp_path: Path) -> Path:
    """The collector store the live column reads: six learners under one course."""
    return _write_store(tmp_path / "collector-data", STORE_PSEUDONYMS)


@pytest.fixture
def small_cohort_store(tmp_path: Path) -> Path:
    """Two distinct pseudonyms: a cohort below `MIN_LEARNERS_DEFAULT`."""
    return _write_store(tmp_path / "small-cohort-data", SMALL_COHORT_PSEUDONYMS)


@pytest.fixture
def sessions_root(tmp_path: Path) -> Path:
    """A `build_report`-readable tree in the durable MCP-host layout
    (`<root>/<pseudonym>/<bundle_id>/telemetry.jsonl`), carrying the SAME events as
    `analytics_store`. The root has no course dimension, because no writer of a
    telemetry stream has one."""
    root = tmp_path / "session-runs"
    for index, pseudonym in enumerate(STORE_PSEUDONYMS):
        write_stream(root, (pseudonym, STORE_LESSON), session_events(pseudonym, index))
    return root


@pytest.fixture
def cfg(course_root: Path, eval_root: Path, validity_root: Path,
        analytics_store: Path, sessions_root: Path):
    from observatory_config import ObservatoryConfig

    return ObservatoryConfig(course_root=course_root, courses=(), eval_root=eval_root,
                             validity_root=validity_root, analytics_data_dir=analytics_store,
                             sessions_root=sessions_root)


@pytest.fixture
def client(cfg: ObservatoryConfig):
    """The whole application over the synthetic roots, no network and no server."""
    from fastapi.testclient import TestClient

    from observatory_app import create_app

    return TestClient(create_app(cfg))


@pytest.fixture
def client_small_cohort(cfg: ObservatoryConfig, small_cohort_store: Path):
    """The same application over a collector store whose only lesson is below the floor."""
    import dataclasses

    from fastapi.testclient import TestClient

    from observatory_app import create_app

    return TestClient(create_app(dataclasses.replace(
        cfg, analytics_data_dir=small_cohort_store)))
