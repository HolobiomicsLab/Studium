"""The two session columns, their floors and the one comparison that is like-for-like.

Two readers, two layouts, one screen: the collector's `metrics.compute_*` over
`<store>/<course>/<YYYY-MM-DD>.jsonl`, and `class_report.build_report` over ONE directory
of `telemetry.jsonl` streams. Neither is reimplemented here (spec R9); this module is a
privacy preflight and a projection over what they return.

What the preflight has to establish before either reader runs, and what each test below
pins down:

* `learner_pseudonym` is `HMAC(learnerId:lessonId)` (`packages/lesson-session/src/adapters/
  pseudonym.ts:3-9`), so a pseudonym identifies a person WITHIN one lesson. A cohort is
  therefore counted per lesson, and one person holding five lesson-salted pseudonyms is
  five learner-lesson pairs, not five people.
* A populated course is not proof of a populated metric: five participants with a single
  audit contributor would put that person's trust result on screen.
* A comparison needs one identical `(lesson_id, bundle_version)` scope on both sides. A
  lesson id alone is not unique, and `"unversioned"` is the collector's bucket for an
  unstamped event, not a version.
* Unreadable is its own state, distinct from absent and from suppressed, and its marker
  carries a basename and an exception class — never a session parent directory (those path
  segments are pseudonyms) and never an exception message.
* Containment runs before every read: neither reader can be pointed outside its root by a
  symlink dropped into it.
"""
from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import pytest
from conftest import (
    STORE_BUNDLE_VERSION,
    STORE_COURSE,
    STORE_LESSON,
    STORE_PSEUDONYMS,
    session_events,
    write_store,
    write_stream,
)

from observatory_config import ENV_ANALYTICS_DATA_DIR, ENV_SESSIONS_ROOT
from observatory_sessions import (
    GAP_TOLERANCE,
    SHOWN_NOT_FLAGGED,
    collector_column,
    divergences,
    sessions_column,
    sessions_detail,
    store_courses,
)


def _batches(n: int = 6, **kwargs) -> list[list]:
    """`n` learners' streams of the same lesson, `n` >= the floor unless a test says so."""
    return [session_events(STORE_PSEUDONYMS[i], i, **kwargs) for i in range(n)]


def _store(root: Path, batches: list[list], course: str = STORE_COURSE) -> Path:
    for events in batches:
        write_store(root, events, course=course)
    return root


def _tree(root: Path, batches: list[list]) -> Path:
    """The durable MCP-host layout: one stream per (pseudonym, bundle). A batch with no
    identity still needs a directory name, and gets one that is not a pseudonym."""
    for index, events in enumerate(batches):
        head = events[0]
        write_stream(root, (head.learner_pseudonym or f"stream-{index}",
                            head.lesson_id or "unknown-lesson"), events)
    return root


def _both(tmp_path: Path, name: str, batches: list[list]) -> tuple[Path, Path]:
    """The same events in both layouts: agreement is then the default state of the pair."""
    return _store(tmp_path / f"{name}-store", batches), _tree(tmp_path / f"{name}-runs", batches)


def _cfg(base, store: Path | None = None, sessions: Path | None = None):
    return dataclasses.replace(base, analytics_data_dir=store, sessions_root=sessions)


def _leaves(value, path: tuple[str, ...] = ()):
    """`(dotted path, leaf)` for every leaf of a JSON-shaped structure."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _leaves(item, (*path, str(key)))
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            yield from _leaves(item, (*path, str(index)))
    else:
        yield ".".join(path), value


def _numbers(payload) -> list[str]:
    """Every path in `payload` that holds a number. A suppressed column must have none:
    that is the difference between a floor and a disclaimer."""
    return [path for path, leaf in _leaves(payload)
            if isinstance(leaf, (int, float)) and not isinstance(leaf, bool)]


def _columns(detail: dict) -> dict:
    """What was measured, with what merely NAMES a reader or a formula removed.

    `shown_not_flagged` quotes both formulas and each column names the reader that ran, so
    a leak check over the whole payload would trip on the page's own explanations. What
    must not leak is a value, and these are the two dicts that carry values.
    """
    return {side: {key: value for key, value in detail[side].items() if key != "reader"}
            for side in ("collector", "sessions")}


#: The artifact scope is source identification, not measurement: `n_scopes` counts
#: `(lesson_id, bundle_version)` pairs in the source, which describe the ARTIFACT and do
#: not vary with who contributed to it. A suppressed column keeps them (INT-STUDIUM-026),
#: so the numeric guard names what it forbids instead of forbidding every number.
#:
#: This exemption is deliberately narrow. It applies to the NUMERIC check only — the
#: pseudonym and identifier checks below still run over the whole column, `scope_note`
#: included, because the point of those is to catch a value nobody expected to be there.
_ARTIFACT_SCOPE_PATHS = ("n_scopes",)


def _cohort_numbers(payload) -> list[str]:
    """`_numbers`, minus the artifact-scope fields a suppressed column is allowed to keep."""
    return [path for path in _numbers(payload)
            if path.rsplit(".", 1)[-1] not in _ARTIFACT_SCOPE_PATHS]


def _row(detail: dict, indicator: str) -> dict:
    rows = [r for r in detail["divergences"] if r["indicator"] == indicator]
    assert len(rows) == 1, f"expected exactly one {indicator} row, got {rows}"
    return rows[0]


def _store_file(store: Path, course: str = STORE_COURSE) -> Path:
    files = sorted((store / course).glob("*.jsonl"))
    assert files, f"no store file under {store / course}"
    return files[-1]


# --------------------------------------------------------------------------------------
# the pair, when both sides carry the same events
# --------------------------------------------------------------------------------------


def test_the_two_columns_agree_on_the_same_events(cfg):
    detail = sessions_detail(cfg, STORE_COURSE)

    assert detail["collector"]["status"] == "ok"
    assert detail["sessions"]["status"] == "ok"
    assert detail["comparison"]["status"] == "comparable"
    assert detail["comparison"]["scope"] == [STORE_LESSON, STORE_BUNDLE_VERSION]
    assert detail["divergences"], "both columns are ok: the pair must be compared"
    for row in detail["divergences"]:
        assert row["comparable"] is True, row
        assert row["diverges"] is False, row
    # `class_report` rounds its gap to 3 dp and the collector keeps it raw, so identical
    # events differ by rounding alone; the tolerance is what keeps that from alarming.
    assert GAP_TOLERANCE == 5e-4
    assert abs(_row(detail, "trust_gap")["collector"]
               - _row(detail, "trust_gap")["sessions"]) <= GAP_TOLERANCE


def test_both_readers_are_named_next_to_the_path_they_read(cfg):
    detail = sessions_detail(cfg, STORE_COURSE)
    assert detail["collector"]["store"] == str(cfg.analytics_data_dir)
    assert detail["sessions"]["root"] == str(cfg.sessions_root)
    assert "compute_" in detail["collector"]["reader"]
    assert "build_report" in detail["sessions"]["reader"]


def test_a_learner_count_divergence_is_flagged(cfg, sessions_root):
    # One learner's whole stream removed from the session tree: 6 on the store, 5 here.
    stream = sessions_root / STORE_PSEUDONYMS[0] / STORE_LESSON / "telemetry.jsonl"
    stream.unlink()

    detail = sessions_detail(cfg, STORE_COURSE)
    row = _row(detail, "n_learners")
    assert row["comparable"] is True
    assert row["diverges"] is True
    assert (row["collector"], row["sessions"]) == (6, 5)


def test_a_trust_gap_divergence_is_flagged(cfg, analytics_store):
    from telemetry_events import AIAuditResult

    # A second grounded audit of the SAME scene, on the store only: pooled per scene_id,
    # over_trust rises from 6/18 to 24/36 and the gap crosses TRUST_WELL_BAND.
    for index, pseudonym in enumerate(STORE_PSEUDONYMS):
        write_store(analytics_store, [AIAuditResult(
            event_id=f"{pseudonym}-extra-audit", learner_pseudonym=pseudonym,
            lesson_id=STORE_LESSON, bundle_version=STORE_BUNDLE_VERSION,
            client_timestamp=f"2026-09-05T11:{index:02d}:00Z", type="ai_audit_result",
            scene_id="s2-audit", planted_errors=3, true_positives=0, false_positives=0,
            missed=3, sound_total=4)])

    detail = sessions_detail(cfg, STORE_COURSE)
    gap = _row(detail, "trust_gap")
    assert gap["diverges"] is True
    assert gap["collector"] - gap["sessions"] > GAP_TOLERANCE
    band = _row(detail, "trust_band")
    assert band["diverges"] is True
    assert (band["collector"], band["sessions"]) == ("sur", "bien")


def test_completion_and_autonomy_are_shown_and_not_flagged(cfg):
    detail = sessions_detail(cfg, STORE_COURSE)
    assert {row["indicator"] for row in detail["divergences"]} == {
        "n_learners", "trust_gap", "trust_band"}

    text = json.dumps(detail["shown_not_flagged"])
    for fragment in ("scene_completed", "lesson_completed", "n_critique", "scaffolding"):
        assert fragment in text, fragment
    assert detail["shown_not_flagged"] == list(SHOWN_NOT_FLAGGED)
    # Both columns still SHOW them; they are simply not paired.
    assert detail["collector"]["course_completion"]["status"] == "ok"
    assert detail["sessions"]["report"]["completion"]["status"] == "ok"
    assert detail["collector"]["autonomy"]["status"] == "ok"
    assert detail["sessions"]["report"]["autonomy"]["status"] == "ok"


def test_the_operator_projection_omits_the_report_payloads_it_must_not_publish(cfg):
    """A whole-directory read is not evidence for a sparse metric: `build_report`'s
    concept, adaptation-rule, reteach and per-scene payloads are not on this surface, and
    neither is the collector's raw per-scene trust list."""
    detail = sessions_detail(cfg, STORE_COURSE)
    dumped = json.dumps(_columns(detail))
    for forbidden in ("concepts", "reteach_priority", "top_adaptation_rules",
                      "universe_escalations", "per_scene"):
        assert forbidden not in dumped, forbidden
    # The trust families are summaries, key by key: no scene list on either side.
    assert set(detail["sessions"]["report"]["trust"]) == {
        "status", "reason", "measured", "n_scenes", "gap", "band"}
    assert set(detail["collector"]["trust"]) == {
        "status", "reason", "trust_calibration", "band", "n_audits", "over_trust",
        "over_distrust"}


# --------------------------------------------------------------------------------------
# cohorts: per lesson, over identities, before either reader runs
# --------------------------------------------------------------------------------------


def test_both_columns_are_suppressed_together_below_the_floor(cfg, small_cohort_store):
    detail = sessions_detail(_cfg(cfg, small_cohort_store, cfg.sessions_root), STORE_COURSE)

    assert detail["collector"]["status"] == "suppressed"
    assert detail["sessions"]["status"] == "suppressed"
    assert detail["divergences"] == []
    assert detail["min_learners"] == 5
    for column in ("collector", "sessions"):
        reason = detail[column]["reason"]
        assert "5" in reason and "learner" in reason, reason
    # No exact count, no rate, no scene: a floor, not a disclaimer. The artifact scope is
    # not one of those — it says which lesson was suppressed, which is what lets an
    # operator act on the suppression (INT-STUDIUM-026).
    assert _cohort_numbers(_columns(detail)) == []
    dumped = json.dumps(_columns(detail))
    for forbidden in ("s1-quiz", "s2-audit", *STORE_PSEUDONYMS):
        assert forbidden not in dumped, forbidden


def test_one_person_holding_five_lesson_salted_identities_stays_suppressed(cfg, tmp_path):
    """`HMAC(learnerId:lessonId)`: the same human is a different pseudonym in every lesson.
    Five of them is one person, and five lessons of one participant each — never a cohort,
    however the union is counted."""
    store = tmp_path / "one-person-five-lessons"
    for index in range(5):
        lesson = f"lesson-{index}"
        _store(store, [session_events(f"pseudo-salted-{index}", index, lesson_id=lesson,
                                      bundle_version=f"1.1:{lesson}@2026-09-01T10:00:00Z")])

    column = collector_column(_cfg(cfg, store), STORE_COURSE)
    assert column["status"] == "suppressed"
    assert "lesson" in column["reason"]
    assert _numbers(column) == []


def test_an_event_without_an_identity_suppresses_its_source(cfg, tmp_path):
    store, runs = _both(tmp_path, "unknown-identity", [*_batches(6), session_events("", 6)])

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["collector"]["status"] == "suppressed"
    assert "identity" in detail["collector"]["reason"]
    # The session reader would have filled the gap with the stream's FILE PATH
    # (`class_report.py:164-172`), which is a pseudonym-bearing directory, not an identity.
    assert detail["sessions"]["status"] == "suppressed"
    assert detail["divergences"] == []
    # `class_report` falls back to `stream:<file path>` as the identity of a stream that
    # carries no pseudonym. That path is a directory name, not a person, and it is neither
    # counted as one nor echoed in the reason.
    assert "stream-6" not in json.dumps(_columns(detail))


def test_a_stream_with_no_lesson_id_suppresses_its_source(cfg, tmp_path):
    runs = _tree(tmp_path / "no-lesson-runs", [*_batches(6), session_events("pseudo-x", 9,
                                                                            lesson_id="")])
    column = sessions_column(_cfg(cfg, sessions=runs))
    assert column["status"] == "suppressed"
    assert "lesson" in column["reason"]
    assert _numbers(column) == []


def test_the_floor_counts_learners_not_files(cfg, sessions_root):
    """The durable host layout writes one stream per (pseudonym, bundle), so counting
    files reports a cohort larger than the class is — the wrong side of a floor to be
    wrong on (the regression INT-STUDIUM-019 fixed, asserted here for the pair)."""
    write_stream(sessions_root, (STORE_PSEUDONYMS[0], "second-bundle-dir"),
                 session_events(STORE_PSEUDONYMS[0], 0))

    column = sessions_column(cfg)
    assert column["status"] == "ok"
    assert column["n_streams"] == 7
    assert column["n_learners"] == 6
    assert column["report"]["n_learners"] == 6


def test_multiple_lessons_are_learner_lesson_pairs_not_people(cfg, tmp_path):
    batches = _batches(6) + [
        session_events(f"pseudo-second-{i}", i, lesson_id="second-lesson",
                       bundle_version="1.1:second-lesson@2026-09-02T10:00:00Z")
        for i in range(6)]
    store, runs = _both(tmp_path, "two-lessons", batches)

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    for column in (detail["collector"], detail["sessions"]):
        assert column["status"] == "ok"
        assert column["n_learners"] is None, "a pseudonym is not a cross-lesson person id"
        assert column["n_learner_lesson_pairs"] == 12
    assert detail["sessions"]["report"]["n_learners"] is None
    assert detail["sessions"]["report"]["n_learner_lesson_pairs"] == 12
    # Two lessons is two scopes: nothing is paired, and nothing is flagged.
    assert detail["divergences"] == []
    assert detail["comparison"]["status"] == "incomparable"
    assert "scope" in detail["comparison"]["reason"]


def test_a_per_scene_learner_count_is_relabelled_across_lessons(cfg, tmp_path):
    """`compute_progress` pools its per-scene `n_learners` across lessons, so across
    lessons that number is a learner-lesson pair count too."""
    batches = _batches(6) + [
        session_events(f"pseudo-second-{i}", i, lesson_id="second-lesson",
                       bundle_version="1.1:second-lesson@2026-09-02T10:00:00Z")
        for i in range(6)]
    column = collector_column(_cfg(cfg, _store(tmp_path / "pairs-store", batches)), STORE_COURSE)

    scene = column["progress"]["scenes"]["s1-quiz"]
    assert scene["n_learners"] is None
    assert scene["n_learner_lesson_pairs"] == 12


# --------------------------------------------------------------------------------------
# a populated course is not proof of a populated metric
# --------------------------------------------------------------------------------------


def test_a_single_audit_contributor_does_not_reach_the_page(cfg, tmp_path):
    """Six participants, one of whom audited: the trust family is that one person's
    result, and both sides of the pair have to withhold it."""
    batches = [session_events(STORE_PSEUDONYMS[i], i, audit=(i == 0)) for i in range(6)]
    store, runs = _both(tmp_path, "one-auditor", batches)

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["collector"]["status"] == "ok"
    assert detail["sessions"]["status"] == "ok"
    assert detail["collector"]["trust"]["status"] == "suppressed"
    assert set(detail["collector"]["trust"]) == {"status", "reason"}
    assert set(detail["sessions"]["report"]["trust"]) == {"status", "reason"}
    for family in (detail["collector"]["trust"], detail["sessions"]["report"]["trust"]):
        assert "5" in family["reason"] and "contribut" in family["reason"], family
    # Nothing of that audit survives, in either column, at any depth.
    dumped = json.dumps(_columns(detail))
    for forbidden in ("n_audits", "over_trust", "trust_calibration", "gap"):
        assert forbidden not in dumped, forbidden
    for row in (_row(detail, "trust_gap"), _row(detail, "trust_band")):
        assert row["comparable"] is False
        assert row["diverges"] is None
        assert row["collector"] is None and row["sessions"] is None
    # The families that DO have a cohort are unaffected.
    assert detail["collector"]["course_completion"]["status"] == "ok"


def test_a_family_suppressed_on_one_side_suppresses_its_pair(cfg, tmp_path):
    """The pair is the leak: a number withheld on one side and shown on the other is the
    withheld one, by subtraction."""
    store = _store(tmp_path / "paired-store", _batches(6))
    runs = _tree(tmp_path / "paired-runs",
                 [session_events(STORE_PSEUDONYMS[i], i, audit=(i == 0)) for i in range(6)])

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["sessions"]["report"]["trust"]["status"] == "suppressed"
    assert detail["collector"]["trust"]["status"] == "suppressed"
    assert "session runs" in detail["collector"]["trust"]["reason"]
    assert "trust_calibration" not in json.dumps(_columns(detail))


def test_an_autonomy_cohort_is_not_enlarged_by_a_scene_type_its_reader_excludes(cfg, tmp_path):
    """`metrics._is_autonomy_critique` excludes `explain_back` (teach-back is a
    comprehension signal, not AI-critique), so an `explain_back` submission is not an
    autonomy contributor — and five of them cannot lift a cohort of one over the floor."""
    batches = [session_events(STORE_PSEUDONYMS[i], i, audit=False,
                              critique_scene_type="spot_the_flaw" if i == 0 else "explain_back")
               for i in range(6)]
    column = collector_column(_cfg(cfg, _store(tmp_path / "explain-back-store", batches)),
                              STORE_COURSE)

    assert column["status"] == "ok"
    assert column["autonomy"]["status"] == "suppressed"
    assert set(column["autonomy"]) == {"status", "reason"}
    assert "n_critique" not in json.dumps(column)


def test_no_contributor_at_all_is_unmeasured_not_zero(cfg, tmp_path):
    """An absent number must read as "not measured here", never as a measurement of zero
    and never as agreement."""
    batches = _batches(6, audit=False)
    store, runs = _both(tmp_path, "no-audits", batches)

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["collector"]["trust"]["status"] == "unmeasured"
    assert detail["sessions"]["report"]["trust"]["status"] == "unmeasured"
    assert "not measured" in detail["collector"]["trust"]["reason"]
    for row in (_row(detail, "trust_gap"), _row(detail, "trust_band")):
        assert row["comparable"] is False
        assert row["diverges"] is None
        assert "not measured" in row["note"]
    # The rest of the pair still compares.
    assert _row(detail, "n_learners")["diverges"] is False


# --------------------------------------------------------------------------------------
# one matching artifact scope, or no comparison at all
# --------------------------------------------------------------------------------------


def test_different_bundle_versions_are_shown_but_not_compared(cfg, tmp_path):
    store = _store(tmp_path / "v1-store", _batches(6))
    runs = _tree(tmp_path / "v2-runs",
                 _batches(6, bundle_version=f"1.2:{STORE_LESSON}@2026-09-06T10:00:00Z"))

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["collector"]["status"] == "ok"
    assert detail["sessions"]["status"] == "ok"
    assert detail["divergences"] == []
    assert detail["comparison"]["status"] == "incomparable"
    assert "bundle_version" in detail["comparison"]["reason"]
    # Both columns keep their own numbers: incomparable is not suppressed.
    assert detail["collector"]["trust"]["status"] == "ok"
    assert detail["sessions"]["report"]["trust"]["status"] == "ok"


def test_an_unversioned_scope_is_not_a_version(cfg, tmp_path):
    """`store.read_events_for_course` buckets an unstamped event under `"unversioned"`.
    Two unstamped sources are not two views of one artifact."""
    store, runs = _both(tmp_path, "unversioned", _batches(6, bundle_version="unversioned"))

    detail = sessions_detail(_cfg(cfg, store, runs), STORE_COURSE)
    assert detail["divergences"] == []
    assert detail["comparison"]["status"] == "incomparable"
    assert "unversioned" in detail["comparison"]["reason"]


def test_an_unrelated_course_in_the_store_raises_no_flag(cfg, analytics_store):
    """A second course in the same store is a different artifact. Selecting it compares
    nothing, and it does not disturb the course that does pair."""
    _store(analytics_store, _batches(6, lesson_id="other-lesson",
                                     bundle_version="1.1:other-lesson@2026-09-03T10:00:00Z"),
           course="course-unrelated")

    assert store_courses(cfg) == (STORE_COURSE, "course-unrelated")
    unrelated = sessions_detail(cfg, "course-unrelated")
    assert unrelated["collector"]["status"] == "ok"
    assert unrelated["divergences"] == []
    assert unrelated["comparison"]["status"] == "incomparable"

    paired = sessions_detail(cfg, STORE_COURSE)
    assert paired["comparison"]["status"] == "comparable"
    assert all(row["diverges"] is False for row in paired["divergences"])


# --------------------------------------------------------------------------------------
# absent, and unreadable, are not suppressed
# --------------------------------------------------------------------------------------


def test_an_absent_store_leaves_the_session_column_alone(cfg):
    detail = sessions_detail(_cfg(cfg, None, cfg.sessions_root), STORE_COURSE)
    assert detail["collector"]["status"] == "absent"
    assert ENV_ANALYTICS_DATA_DIR in detail["collector"]["reason"]
    assert detail["sessions"]["status"] == "ok"
    assert detail["divergences"] == []
    assert store_courses(_cfg(cfg, None)) == ()


def test_an_absent_session_root_leaves_the_collector_column_alone(cfg):
    detail = sessions_detail(_cfg(cfg, cfg.analytics_data_dir, None), STORE_COURSE)
    assert detail["sessions"]["status"] == "absent"
    assert ENV_SESSIONS_ROOT in detail["sessions"]["reason"]
    assert detail["collector"]["status"] == "ok"
    assert detail["collector"]["trust"]["status"] == "ok"
    assert detail["divergences"] == []


def test_no_course_means_the_collector_column_says_so(cfg):
    detail = sessions_detail(cfg, None)
    assert detail["course"] is None
    assert detail["collector"]["status"] == "absent"
    assert "course" in detail["collector"]["reason"]
    assert detail["sessions"]["status"] == "ok"


def test_a_malformed_line_in_the_store_is_unreadable(cfg, analytics_store):
    target = _store_file(analytics_store)
    with target.open("a", encoding="utf-8") as handle:
        handle.write("{not json at all\n")

    detail = sessions_detail(cfg, STORE_COURSE)
    assert detail["collector"]["status"] == "unreadable"
    assert target.name in detail["collector"]["reason"]
    assert "JSONDecodeError" in detail["collector"]["reason"]
    assert _numbers(detail["collector"]) == []
    # `read_events_for_course` skips a broken line in silence, so without this preflight
    # the column would show a number computed over part of the file.
    assert detail["sessions"]["status"] == "ok"
    assert detail["divergences"] == []


def test_a_line_that_is_not_an_object_is_unreadable(cfg, sessions_root):
    stream = sessions_root / STORE_PSEUDONYMS[1] / STORE_LESSON / "telemetry.jsonl"
    with stream.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps([1, 2, 3]) + "\n")

    detail = sessions_detail(cfg, STORE_COURSE)
    assert detail["sessions"]["status"] == "unreadable"
    assert "telemetry.jsonl" in detail["sessions"]["reason"]
    assert "list" in detail["sessions"]["reason"]
    assert detail["collector"]["status"] == "ok"
    assert detail["divergences"] == []


@pytest.mark.parametrize("column,other", [("sessions", "collector"), ("collector", "sessions")])
def test_an_injected_read_fault_is_unreadable_on_that_source_only(
        cfg, monkeypatch, column, other):
    real = Path.read_text

    def fault(self, *args, **kwargs):
        # The session runs are the `telemetry.jsonl` streams; the store's own files are the
        # dated JSONL partitions. One source faults per run, so the other has to survive.
        stream = self.name == "telemetry.jsonl"
        if self.suffix == ".jsonl" and stream == (column == "sessions"):
            raise OSError(13, "SECRET-ERRNO-DETAIL /var/private/pseudo-store-0")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", fault)
    detail = sessions_detail(cfg, STORE_COURSE)

    assert detail[column]["status"] == "unreadable"
    # errno 13 raises the OSError subclass Python maps it to, and the marker names the
    # class that was actually raised — never the message, which carries the path.
    assert "PermissionError" in detail[column]["reason"]
    assert detail[other]["status"] == "ok"
    assert detail["divergences"] == []
    dumped = json.dumps(detail)
    assert "SECRET-ERRNO-DETAIL" not in dumped
    assert "/var/private" not in dumped


def test_an_unreadable_marker_names_no_pseudonym_and_no_parent_directory(cfg, sessions_root):
    """Every path segment above a `telemetry.jsonl` is a pseudonym or a bundle id
    (`<pseudonym>/<bundle_id>/`), so a marker may carry the basename and the exception
    class, and nothing else."""
    stream = sessions_root / STORE_PSEUDONYMS[2] / STORE_LESSON / "telemetry.jsonl"
    with stream.open("a", encoding="utf-8") as handle:
        handle.write("}\n")

    detail = sessions_detail(cfg, STORE_COURSE)
    assert detail["sessions"]["status"] == "unreadable"
    dumped = json.dumps(detail)
    for pseudonym in STORE_PSEUDONYMS:
        assert pseudonym not in dumped, pseudonym
    assert str(stream.parent) not in dumped
    assert str(sessions_root) in dumped  # the configured root is the operator's own


# --------------------------------------------------------------------------------------
# containment, before the scan and before the read
# --------------------------------------------------------------------------------------


def test_a_store_child_symlink_out_of_the_root_is_not_listed(cfg, tmp_path):
    outside = _store(tmp_path / "outside-store", _batches(6), course="course-elsewhere")
    store = _store(tmp_path / "contained-store", _batches(6))
    (store / "course-linked").symlink_to(outside / "course-elsewhere",
                                         target_is_directory=True)

    contained = _cfg(cfg, store, cfg.sessions_root)
    assert store_courses(contained) == (STORE_COURSE,)
    linked = collector_column(contained, "course-linked")
    assert linked["status"] == "absent"
    assert _numbers(linked) == []


def test_a_session_directory_symlink_out_of_the_root_is_not_followed(cfg, tmp_path):
    outside = _tree(tmp_path / "outside-runs", _batches(6, lesson_id="elsewhere-lesson"))
    runs = _tree(tmp_path / "contained-runs", _batches(6))
    (runs / "linked-tree").symlink_to(outside, target_is_directory=True)

    column = sessions_column(_cfg(cfg, sessions=runs))
    assert column["status"] == "ok"
    assert column["n_streams"] == 6, "the linked tree's six streams must not be read"
    assert column["lessons"] == [STORE_LESSON]


def test_a_session_file_symlink_out_of_the_root_is_refused_before_the_read(cfg, tmp_path):
    outside = _tree(tmp_path / "outside-file-runs", _batches(1))
    runs = _tree(tmp_path / "linked-file-runs", _batches(6))
    link = runs / "pseudo-linked" / STORE_LESSON / "telemetry.jsonl"
    link.parent.mkdir(parents=True)
    link.symlink_to(outside / STORE_PSEUDONYMS[0] / STORE_LESSON / "telemetry.jsonl")

    column = sessions_column(_cfg(cfg, sessions=runs))
    # `build_report` finds its input with `rglob("telemetry.jsonl")`, which matches a file
    # symlink and would read straight through it. It never runs.
    assert column["status"] == "unreadable"
    assert "root" in column["reason"]
    assert _numbers(column) == []


def test_a_store_file_symlink_out_of_the_root_is_refused_before_the_read(cfg, tmp_path):
    outside = _store(tmp_path / "outside-file-store", _batches(1))
    store = _store(tmp_path / "linked-file-store", _batches(6))
    (store / STORE_COURSE / "2026-01-01.jsonl").symlink_to(_store_file(outside))

    column = collector_column(_cfg(cfg, store), STORE_COURSE)
    assert column["status"] == "unreadable"
    assert "root" in column["reason"]
    assert _numbers(column) == []


# --------------------------------------------------------------------------------------
# the divergence function on its own
# --------------------------------------------------------------------------------------


def test_divergences_is_computed_from_the_two_columns_alone(cfg):
    detail = sessions_detail(cfg, STORE_COURSE)
    assert divergences(detail["collector"], detail["sessions"]) == detail["divergences"]


def test_divergences_of_an_absent_column_is_empty(cfg):
    assert divergences(collector_column(_cfg(cfg), STORE_COURSE), sessions_column(_cfg(cfg))) == []


# --------------------------------------------------------------------------------------
# the four routes and the page (task 5)
# --------------------------------------------------------------------------------------


def _client(base, store: Path | None = None, sessions: Path | None = None):
    from fastapi.testclient import TestClient

    from observatory_app import create_app

    return TestClient(create_app(_cfg(base, store, sessions)))


def test_sessions_page_names_both_readers_and_both_paths(client, cfg):
    response = client.get(f"/sessions/{STORE_COURSE}")
    assert response.status_code == 200
    for fragment in ("collector store", "session runs", str(cfg.analytics_data_dir),
                     str(cfg.sessions_root), "build_report", "compute_trust_calibration"):
        assert fragment in response.text, fragment


def test_the_page_says_the_session_column_is_not_course_scoped(client):
    """The one sentence an operator needs next to the `{course}` in the URL. Asserted on a
    distinctive fragment, so deleting it fails this test."""
    assert "scopes the collector store column only" in client.get(
        f"/sessions/{STORE_COURSE}").text


def test_the_page_shows_the_two_flagged_indicators_and_the_two_it_does_not_flag(client):
    text = client.get(f"/sessions/{STORE_COURSE}").text
    for fragment in ("n_learners", "trust_gap", "trust_band", "agree",
                     "Shown, not flagged", "scene_completed", "lesson_completed",
                     "n_critique", "scaffolding"):
        assert fragment in text, fragment


def test_a_flagged_row_is_marked_on_the_page(client, sessions_root):
    (sessions_root / STORE_PSEUDONYMS[0] / STORE_LESSON / "telemetry.jsonl").unlink()
    text = client.get(f"/sessions/{STORE_COURSE}").text
    assert "diverges" in text
    assert 'class="defect">diverges' in text


def test_the_page_explains_an_incomparable_scope_instead_of_flagging_it(cfg, tmp_path):
    runs = _tree(tmp_path / "other-version-runs",
                 _batches(6, bundle_version=f"1.2:{STORE_LESSON}@2026-09-06T10:00:00Z"))
    with _client(cfg, cfg.analytics_data_dir, runs) as client:
        text = client.get(f"/sessions/{STORE_COURSE}").text
    assert "nothing is paired and nothing is flagged" in text
    assert "diverges" not in text
    # Both columns still show their own numbers: incomparable is not suppressed.
    assert "trust_calibration" in text or "over_trust" in text


def test_the_suppression_banner_names_the_floor_and_no_number(cfg, small_cohort_store):
    from conftest import SMALL_COHORT_PSEUDONYMS

    with _client(cfg, small_cohort_store, cfg.sessions_root) as client:
        response = client.get(f"/sessions/{STORE_COURSE}")
    assert response.status_code == 200
    assert "k-anonymity floor" in response.text
    assert "suppressed" in response.text
    for pseudonym in SMALL_COHORT_PSEUDONYMS:
        assert pseudonym not in response.text


def test_an_unreadable_source_is_a_marker_on_a_200_page(client, sessions_root):
    stream = sessions_root / STORE_PSEUDONYMS[3] / STORE_LESSON / "telemetry.jsonl"
    with stream.open("a", encoding="utf-8") as handle:
        handle.write("}\n")

    response = client.get(f"/sessions/{STORE_COURSE}")
    assert response.status_code == 200
    assert "unreadable: telemetry.jsonl" in response.text
    for pseudonym in STORE_PSEUDONYMS:
        assert pseudonym not in response.text, pseudonym


def test_sessions_index_renders_without_a_course(cfg, client):
    response = client.get("/sessions")
    assert response.status_code == 200
    assert str(cfg.sessions_root) in response.text
    assert "needs a course" in response.text


def test_the_nav_reaches_the_sessions_page(client):
    assert 'href="/sessions"' in client.get("/").text


def test_unknown_course_is_404(cfg, client):
    for url in (f"/sessions/{STORE_COURSE}-nope", f"/api/sessions/{STORE_COURSE}-nope"):
        assert client.get(url).status_code == 404, url

    # With no store configured there is no id to resolve, so every one 404s — and the
    # index still renders the session column alone.
    with _client(cfg, None, cfg.sessions_root) as bare:
        assert bare.get(f"/sessions/{STORE_COURSE}").status_code == 404
        assert bare.get(f"/api/sessions/{STORE_COURSE}").status_code == 404
        assert bare.get("/sessions").status_code == 200
        assert bare.get("/api/sessions").status_code == 200


def test_json_twins_match_the_reader(client, cfg):
    assert client.get(f"/api/sessions/{STORE_COURSE}").json() == sessions_detail(
        cfg, STORE_COURSE)
    assert client.get("/api/sessions").json() == sessions_detail(cfg, None)
