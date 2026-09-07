"""The Sessions surface against telemetry no emitter should have written.

Slice 2 hardened the Review surface against artifacts nobody emitted (`5267cdb`) and left
the Sessions surface, which reads learner telemetry, with the same defect class open. Four
things a stream or a store can carry, and what the projection owes each of them:

* a **non-finite number** (`NaN`, `Infinity`) in a field a reader averages. It survives
  `json.loads`, it survives an `isinstance(value, (int, float))` gate, and it reaches the
  two twins differently: pydantic serialises it to `null` in the JSON twin, so the family
  reads `{"status": "ok", "mean_autonomy": null}` — indistinguishable from a family that
  ran and found nothing — while `"%.4g" % float("nan")` puts the literal `nan` on the page.
  Amendment 2: a value that was not measured must never read as a measurement.
* a **wrong-typed** field. The preflight checks that a line parses and is an object, never
  that a field holds the type its reader will pass to `int()`, so one `"planted_errors":
  "abc"` reaches `metrics.compute_trust_calibration` and raises. Amendment 4: bad types
  yield an explicit HTTP-200 unreadable state, not a crash.
* a **term with no contributors**. `compute_autonomy` divides by `n_critique` and reports
  `0.0` when there are none, so a course with hint adaptations and no AI-critique
  submissions publishes a rate over an empty population. Amendment 2: zero contributors
  means unmeasured, and autonomy consumes two populations, not one.
* a **key the reader saw and the preflight did not**. The floor is decided on one read and
  the numbers come from another; the collector appends to today's partition while the page
  is being served. A scene id that first appears in the reread is in no `short` set, so it
  is published with its own learner count — under the floor. Amendment 2, and the reason
  the floor exists at all.

Nothing here reimplements a reader or invents a formula: every test asserts that a value is
WITHHELD and named, never that a different number is shown.
"""
from __future__ import annotations

import dataclasses
import json
import re
from pathlib import Path

import metrics
from conftest import (
    STORE_COURSE,
    STORE_LESSON,
    STORE_PSEUDONYMS,
    session_events,
    write_store,
    write_stream,
)

from observatory_sessions import (
    collector_column,
    divergences,
    sessions_column,
)

#: Anything that would put `nan`, `inf` or `-inf` in front of an operator.
NON_FINITE = re.compile(r"\b-?(nan|inf|infinity)\b", re.IGNORECASE)


def _store(root: Path, **kwargs) -> Path:
    """Six learners of one lesson, in the collector's own layout."""
    for index, pseudonym in enumerate(STORE_PSEUDONYMS):
        write_store(root, session_events(pseudonym, index, **kwargs), course=STORE_COURSE)
    return root


def _tree(root: Path, **kwargs) -> Path:
    """The same six learners, in the durable host layout."""
    for index, pseudonym in enumerate(STORE_PSEUDONYMS):
        write_stream(root, (pseudonym, STORE_LESSON),
                     session_events(pseudonym, index, **kwargs))
    return root


def _jsonl(root: Path) -> list[Path]:
    return sorted(root.rglob("*.jsonl"))


def _corrupt(path: Path, event_type: str, **fields) -> None:
    """Rewrite one event type's fields in place, at the JSON level.

    The fixtures build events through the Pydantic mirror, which is exactly what a
    well-behaved emitter does — so a malformed value has to be written the way a broken
    one would write it: straight into the file.
    """
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("type") == event_type:
            event.update(fields)
        lines.append(json.dumps(event))
    path.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")


def _cfg(base, store: Path | None = None, sessions: Path | None = None):
    return dataclasses.replace(base, analytics_data_dir=store, sessions_root=sessions)


# --------------------------------------------------------------------------------------
# a non-finite number is not a measurement
# --------------------------------------------------------------------------------------

def test_a_non_finite_autonomy_ratio_is_not_published_as_a_measurement(cfg, tmp_path):
    """One learner's `NaN` must not leave the family reading `ok` with a null number."""
    root = _tree(tmp_path / "runs")
    _corrupt(_jsonl(root)[0], "lesson_completed", autonomy_ratio=float("nan"))

    family = sessions_column(_cfg(cfg, sessions=root))["report"]["autonomy"]

    assert family["status"] != "ok", family
    assert "mean_autonomy" not in family, "a family that is not ok carries no number"
    assert NON_FINITE.search(json.dumps(family)) is None, family


def test_a_non_finite_critique_completion_rate_is_not_published_as_a_measurement(cfg, tmp_path):
    root = _store(tmp_path / "store")
    _corrupt(_jsonl(root)[0], "critique_submitted", completion_rate=float("nan"))

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["autonomy"]

    assert family["status"] != "ok", family
    assert "critique_completion_rate" not in family
    assert NON_FINITE.search(json.dumps(family)) is None, family


def test_a_string_nan_is_refused_like_the_float(cfg, tmp_path):
    """`float("nan")` succeeds on the string too, so the guard is on the value's TYPE."""
    root = _store(tmp_path / "store")
    _corrupt(_jsonl(root)[0], "critique_submitted", completion_rate="nan")

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["autonomy"]

    assert family["status"] != "ok", family
    assert "critique_completion_rate" not in family


def test_no_non_finite_value_reaches_the_rendered_page(cfg, tmp_path):
    """The JSON twin and the HTML twin must agree; `"%.4g" % nan` is `nan` on the page."""
    from fastapi.testclient import TestClient

    from observatory_app import create_app

    store = _store(tmp_path / "store")
    runs = _tree(tmp_path / "runs")
    _corrupt(_jsonl(store)[0], "critique_submitted", completion_rate=float("nan"))
    _corrupt(_jsonl(runs)[0], "lesson_completed", autonomy_ratio=float("nan"))

    client = TestClient(create_app(_cfg(cfg, store=store, sessions=runs)))
    page = client.get(f"/sessions/{STORE_COURSE}")

    assert page.status_code == 200
    offenders = [line.strip() for line in page.text.splitlines() if NON_FINITE.search(line)]
    assert not offenders, offenders


# --------------------------------------------------------------------------------------
# a wrong type is unreadable, not a crash
# --------------------------------------------------------------------------------------

def test_a_wrong_typed_audit_field_leaves_the_collector_column_unreadable(cfg, tmp_path):
    """`int("abc")` inside the reader must not become a 500 for the whole page."""
    root = _store(tmp_path / "store")
    _corrupt(_jsonl(root)[0], "ai_audit_result", planted_errors="abc")

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["trust"]

    assert family["status"] == "unreadable", family
    assert "trust_calibration" not in family
    reason = family["reason"]
    assert "ValueError" in reason, reason
    assert "/" not in reason and "abc" not in reason, "no path, and no telemetry value"


def test_a_wrong_typed_audit_field_leaves_the_sessions_column_unreadable(cfg, tmp_path):
    root = _tree(tmp_path / "runs")
    _corrupt(_jsonl(root)[0], "ai_audit_result", planted_errors="abc")

    column = sessions_column(_cfg(cfg, sessions=root))

    assert column["status"] == "unreadable", column
    assert column["n_learners"] is None
    assert "/" not in column["reason"], column["reason"]


def test_a_wrong_typed_field_still_answers_both_routes(cfg, tmp_path):
    from fastapi.testclient import TestClient

    from observatory_app import create_app

    store = _store(tmp_path / "store")
    _corrupt(_jsonl(store)[0], "ai_audit_result", planted_errors="abc")

    client = TestClient(create_app(_cfg(cfg, store=store)))

    assert client.get(f"/api/sessions/{STORE_COURSE}").status_code == 200
    assert client.get(f"/sessions/{STORE_COURSE}").status_code == 200


# --------------------------------------------------------------------------------------
# zero contributors is unmeasured, not a measured zero
# --------------------------------------------------------------------------------------

def test_a_course_with_no_critiques_does_not_publish_a_critique_rate(cfg, tmp_path):
    """`n_critique == 0` makes `critique_completion_rate` a rate over nobody."""
    root = _store(tmp_path / "store", critique_scene_type=None)

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["autonomy"]

    assert family["status"] == "unmeasured", family
    assert "critique_completion_rate" not in family
    assert "autonomy_ratio" not in family


# --------------------------------------------------------------------------------------
# a key the preflight never saw was never under the floor
# --------------------------------------------------------------------------------------

def test_a_scene_the_preflight_never_saw_is_withheld(cfg, tmp_path, monkeypatch):
    """The floor is decided on one read; the numbers come from another.

    A scene appended between the two — the collector writes to today's partition while the
    page is being served — is in no `short` set. Publishing it publishes a per-scene
    learner count that no floor was ever applied to.
    """
    root = _store(tmp_path / "store")
    real = metrics.compute_progress

    def one_scene_later(store_root, course):
        read = real(store_root, course)
        scenes = dict(read.get("scenes") or {})
        scenes["s3-appended"] = {"completion_rate": 1.0, "n_learners": 1}
        return {**read, "scenes": scenes}

    monkeypatch.setattr(metrics, "compute_progress", one_scene_later)
    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["progress"]

    assert "s3-appended" not in family.get("scenes", {}), family
    assert family["n_withheld_scenes"] >= 1, family


def test_a_lesson_the_preflight_never_saw_is_withheld(cfg, tmp_path, monkeypatch):
    root = _store(tmp_path / "store")
    real = metrics.compute_course_completion

    def one_lesson_later(store_root, course):
        read = real(store_root, course)
        lessons = dict(read.get("lessons") or {})
        lessons["appended-lesson"] = {"n_completed": 1}
        return {**read, "lessons": lessons}

    monkeypatch.setattr(metrics, "compute_course_completion", one_lesson_later)
    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["course_completion"]

    assert "appended-lesson" not in family.get("lessons", {}), family
    assert family["n_withheld_lessons"] >= 1, family


# --------------------------------------------------------------------------------------
# a non-finite gap is not an agreement
# --------------------------------------------------------------------------------------

def test_a_non_finite_trust_gap_is_never_reported_as_agreement():
    """`abs(nan - nan) > tolerance` is False, which would render "agree"."""
    scope = ["lesson-a", "1.0:lesson-a@2026-09-01T10:00:00Z"]
    collector = {"status": "ok", "scope": scope, "n_learners": 6,
                 "trust": {"status": "ok", "reason": None,
                           "trust_calibration": float("nan"), "band": "bien"}}
    sessions = {"status": "ok", "scope": scope, "n_learners": 6,
                "report": {"trust": {"status": "ok", "reason": None, "measured": True,
                                     "gap": float("nan"), "band": "bien"}}}

    rows = {row["indicator"]: row for row in divergences(collector, sessions)}

    assert rows["trust_gap"]["comparable"] is False, rows["trust_gap"]
    assert rows["trust_gap"]["diverges"] is None


# --------------------------------------------------------------------------------------
# a term with no contributors is not the same as a denominator with none
# --------------------------------------------------------------------------------------

def test_a_course_where_nobody_needed_a_hint_still_publishes_its_autonomy(cfg, tmp_path):
    """`autonomy_ratio` is `n_critique / (n_critique + n_hints)`; with no hints it is 6/6.

    The guard above this one refuses a rate over an empty population, and `n_critique` is
    that population for both of this family's numbers. `n_hints` is not: it is the other
    half of a denominator that already has six contributors, and a lesson scaffolded well
    enough that nobody needed a hint is exactly where a course lands here. Requiring it
    deletes a measurement taken over every learner in the course, under a sentence saying
    the ratio was over nobody.
    """
    root = _store(tmp_path / "store")
    _corrupt(_jsonl(root)[0], "adaptation_applied", signal="prerequisite")

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["autonomy"]

    assert family["status"] == "ok", family
    assert family["autonomy_ratio"] == 1.0, family
    assert family["n_hints"] == 0, family


# --------------------------------------------------------------------------------------
# a family that withholds everything still says why, and does not blame the floor
# --------------------------------------------------------------------------------------

def _only_unseen(monkeypatch, name: str, key: str, row: dict) -> None:
    """Make the reader return one key the preflight never scanned, and nothing else."""
    real = getattr(metrics, name)
    monkeypatch.setattr(metrics, name, lambda store_root, course, _r=real: {
        **_r(store_root, course), key: {"s9-appended": row}})


def test_a_family_that_withholds_every_key_still_names_the_reason(cfg, tmp_path, monkeypatch):
    """Nothing survives, no population was under the floor, and the page must still say why.

    Every non-`ok` state on this surface owes the operator a reason — that is the whole
    contract of the column. A status with `reason: None` renders as `suppressed — None`:
    a number withheld for nothing, and the k-anonymity word asserting a cause that did
    not happen.
    """
    root = _store(tmp_path / "store")
    _only_unseen(monkeypatch, "compute_progress", "scenes",
                 {"completion_rate": 1.0, "n_learners": 6})

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["progress"]

    assert family["status"] != "ok", family
    assert family["reason"], "a family that shows no number owes the reason it shows none"
    assert family["status"] != "suppressed", (
        "`suppressed` reads as the k-anonymity floor, and no population was under it")
    assert "s9-appended" not in json.dumps(family), family


def test_a_withheld_family_never_renders_a_missing_reason(cfg, tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from observatory_app import create_app

    root = _store(tmp_path / "store")
    _only_unseen(monkeypatch, "compute_progress", "scenes",
                 {"completion_rate": 1.0, "n_learners": 6})

    page = TestClient(create_app(_cfg(cfg, store=root))).get(f"/sessions/{STORE_COURSE}")

    assert page.status_code == 200
    offenders = [line.strip() for line in page.text.splitlines() if "— None" in line]
    assert not offenders, offenders
