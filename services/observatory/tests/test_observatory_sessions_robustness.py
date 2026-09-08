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
    _blank,
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


def _corrupt(path: Path, event_type: str, _where: dict | None = None, **fields) -> None:
    """Rewrite one event type's fields in place, at the JSON level.

    The fixtures build events through the Pydantic mirror, which is exactly what a
    well-behaved emitter does — so a malformed value has to be written the way a broken
    one would write it: straight into the file. `_where` narrows the rewrite to the events
    already matching it, for the cases that need one good value beside one bad one.
    """
    lines = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        matches = all(event.get(key) == value for key, value in (_where or {}).items())
        if event.get("type") == event_type and matches:
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


def test_a_key_the_scan_rejected_is_not_reported_as_a_late_arrival(cfg, tmp_path):
    """Withholding it is right; saying *when* it appeared is a claim about a race.

    The preflight requires a non-empty `str` scene id and `compute_progress` does not, so
    a `scene_id: 7` is in the reader's read and in no scan. It is withheld, correctly —
    but it was there all along, and the reason must not tell the operator to look for a
    write that happened while the page was being served.
    """
    root = _store(tmp_path / "store")
    _corrupt(_jsonl(root)[0], "scene_completed", {"scene_id": "s2-audit"}, scene_id=7)

    family = collector_column(_cfg(cfg, store=root), STORE_COURSE)["progress"]

    assert family["status"] == "ok", family
    assert "s1-quiz" in family["scenes"], family
    assert "7" not in family["scenes"], family
    assert family["n_withheld_scenes"] == 1, family
    assert "first seen when the reader ran" not in json.dumps(family), family


def test_a_reader_that_returns_nothing_is_unreadable_not_a_crash():
    """`_read` reports an exception; a `None` return slipped through it into `.get`."""
    from observatory_sessions import _read

    value, reason = _read(lambda: None, "the class report")

    assert value is None
    assert reason, "a reader that produced no document is not a document"


# --------------------------------------------------------------------------------------
# a suppressed column says one thing about its scope, not two (INT-STUDIUM-026)
# --------------------------------------------------------------------------------------

def test_a_blanked_column_does_not_contradict_itself_about_its_scope(cfg, tmp_path):
    """`_blank` kept `scope_note` and dropped `scope`, so the column said both.

    The prose sentence names `lesson_id` and `bundle_version`; the structured field
    carrying exactly the same two values was set to `None` beside it. A reader — or a
    twin-asserting test — got `{"scope": null, "scope_note": "one artifact scope:
    lesson_id=…, bundle_version=…"}`, which is not a privacy question in the first
    instance but a contradiction: the JSON and the sentence disagree about whether the
    scope is known.

    INT-STUDIUM-026 resolves it by keeping all three. `lesson_id` and `bundle_version`
    identify the ARTIFACT, not the cohort — they belong with `reader`, `store`, `root`
    and `course`, which `_blank` already keeps — and under INT-STUDIUM-030's R1 an
    operator who cannot see WHICH lesson was suppressed cannot act on the suppression.
    What `_blank` removes is every measurement of the cohort, which is what its
    docstring now says.
    """
    root = _store(tmp_path / "store")
    column = collector_column(_cfg(cfg, store=root), STORE_COURSE)
    assert column["status"] == "ok", column
    assert column["scope"] is not None, "the fixture must produce one artifact scope"

    blanked = _blank(column, "suppressed", "suppressed with the other column")

    assert blanked["scope"] == column["scope"], "the scope is source identification"
    assert blanked["n_scopes"] == column["n_scopes"]
    assert blanked["scope_note"] == column["scope_note"]
    # And the cohort measurements are still gone.
    assert blanked["autonomy"]["status"] == "suppressed", blanked["autonomy"]
    assert blanked["n_learners"] is None, blanked
