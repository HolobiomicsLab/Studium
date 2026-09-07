"""The two session sources, side by side, and the one comparison that is like-for-like.

Two readers, two layouts, one screen (spec R6):

* the collector's `metrics.compute_*`, over `<store>/<course>/<YYYY-MM-DD>.jsonl`;
* `class_report.build_report`, over ONE directory of `telemetry.jsonl` streams, which it
  discovers itself with `rglob("telemetry.jsonl")`.

Neither formula is reimplemented here (spec R9). What this module adds is the part neither
reader can do for itself: a privacy preflight over identity, scope and contributor
metadata, and a projection that publishes only the operator indicators the plan names.

Why a preflight at all, when both readers already have a floor:

* `learner_pseudonym` is `HMAC(learnerId:lessonId)` (`packages/lesson-session/src/adapters/
  pseudonym.ts:3-9`), so it identifies a person WITHIN one lesson. A cohort is therefore
  counted per lesson: one person holding five lesson-salted pseudonyms is five
  learner-lesson pairs and never five people, whichever union is taken.
* A populated course is not proof of a populated metric. Five participants of whom one
  audited would put that one person's trust result on screen, above any cohort floor.
* `build_report` falls back to the stream's FILE PATH as an identity when a stream carries
  no pseudonym (`tools/class_report.py:164-172`), and its suppressed shape returns the
  exact cohort size. Neither may reach a response.
* `store.read_events_for_course` skips a malformed line in silence, so a number computed
  over half a file would look like a number computed over the file.

Every column carries one of five states, and they are not the same thing:

``absent``      nothing is configured, or the configured directory is gone.
``empty``       the source is readable and holds no telemetry event.
``unreadable``  a file could not be read, parsed, or is not what it claims to be.
``suppressed``  there is data, and the k-anonymity floor withholds it.
``ok``          the reader ran; each metric family then answers for itself.

`_within` is `observatory_discovery`'s containment rule and `_is_autonomy_critique` is the
collector's own scope predicate. Both are private names of their modules, imported here
deliberately rather than copied: a second copy of a containment check or of a scene-type
rule is how the two `autonomy_ratio` definitions came to disagree in the first place.
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any

from observatory_config import ENV_ANALYTICS_DATA_DIR, ENV_SESSIONS_ROOT, ObservatoryConfig
from observatory_discovery import _within  # noqa: F401  (the containment rule of the roots)
from observatory_paths import ensure_importable

ensure_importable()

import metrics  # noqa: E402  (the collector's own aggregations, and its scope predicate)
from class_report import build_report  # noqa: E402  (the runtime-side class report)

LOGGER = logging.getLogger(__name__)

#: `class_report` rounds its trust gap to 3 decimals and `metrics` keeps it raw, so the
#: same audits differ by up to half of the last place kept. Below this, the two columns
#: are reporting the same number and a flag would be an alarm about rounding.
GAP_TOLERANCE = 5e-4

COLLECTOR_LABEL = "collector store"
SESSIONS_LABEL = "session runs"
COLLECTOR_READER = ("analytics-collector metrics.compute_progress / compute_course_completion "
                    "/ compute_autonomy / compute_trust_calibration, over "
                    "<store>/<course>/<YYYY-MM-DD>.jsonl")
SESSIONS_READER = ('class_report.build_report, over ONE directory — it finds its own input '
                   'with rglob("telemetry.jsonl") and reads every stream under the root')

#: The collector's bucket for an event with no `bundle_version`, not a version.
UNVERSIONED = "unversioned"

#: The sentence the operator needs next to the `{course}` in the URL.
SESSION_SCOPE_NOTE = (
    "No writer of a telemetry stream stamps a course: the durable host tree is keyed by "
    "pseudonym (<pseudonym>/<bundle_id>/telemetry.jsonl) and an eval run's by persona. The "
    "session runs column is therefore the whole configured directory, and the course in the "
    "URL scopes the collector store column only.")

#: Completion and autonomy are SHOWN with the formula that produced them, and not flagged:
#: the two sides measure different populations, and one pair of them does not even share a
#: definition. A module constant so the page and the JSON twin cannot drift apart.
SHOWN_NOT_FLAGGED: tuple[dict[str, str], ...] = (
    {
        "indicator": "completion",
        "collector": "compute_progress: the share of `scene_completed` events carrying "
                     "success=true, per scene_id — a rate over EVENTS. compute_course_completion "
                     "counts, per lesson, the distinct learners who emitted `lesson_completed`.",
        "sessions": "build_report: `lesson_completed` events divided by `lesson_started` "
                    "events over the whole directory — a rate over lesson ATTEMPTS, pooled "
                    "across every stream it found.",
        "why_not_flagged": "Different numerators over different populations. A difference "
                           "between them is the definition, not a fault; flagging it would "
                           "raise an alarm that can never be cleared.",
    },
    {
        "indicator": "autonomy",
        "collector": "compute_autonomy: n_critique / (n_critique + n_hints), where n_critique "
                     "counts `critique_submitted` from AI-critique scenes only and n_hints "
                     "counts `adaptation_applied` with signal \"hint\" (the scaffolding "
                     "modulator) — a class-level ratio of events.",
        "sessions": "build_report: the mean of the `autonomy_ratio` scalar the runtime stamps "
                    "on each `lesson_completed` — a mean of per-session values computed on "
                    "the device.",
        "why_not_flagged": "Two definitions of \"autonomy ratio\" that share a name and not a "
                           "formula. That collision is a defect in its own right, filed as a "
                           "Draft intent, and it is not resolved on this page.",
    },
)


# --------------------------------------------------------------------------------------
# the preflight: identity, scope and contributor metadata, and nothing else
# --------------------------------------------------------------------------------------


class _Scan:
    """Metadata for the policy decision, held only long enough to make it.

    The sets in here are learner pseudonyms. They decide what may be computed and are then
    dropped: no member of this object is ever serialised.
    """

    def __init__(self) -> None:
        #: lesson_id -> the pseudonyms seen in it (a cohort, per lesson)
        self.participants: dict[str, set[str]] = defaultdict(set)
        #: family -> term -> partition key -> the pseudonyms that CONTRIBUTED to it
        self.terms: dict[str, dict[str, dict[tuple[str, ...], set[str]]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(set)))
        #: the (lesson_id, bundle_version) artifact scopes the source spans
        self.scopes: set[tuple[str, str]] = set()
        self.unknown_identity = False
        self.unreadable: str | None = None

    def contributor(self, family: str, term: str, key: tuple[str, ...], pseudonym: str) -> None:
        self.terms[family][term][key].add(pseudonym)


def _marker(basename: str, detail: str) -> str:
    """The whole of what an unreadable state may say.

    A basename and an exception class. Every path segment ABOVE a `telemetry.jsonl` is a
    pseudonym or a bundle id, and an exception message carries the path it failed on, so
    neither the parent directories nor the message can appear here. Both are logged.
    """
    return f"unreadable: {basename} ({detail})"


def _identity(event: Mapping[str, Any]) -> tuple[str, str] | None:
    """`(pseudonym, lesson_id)`, or None when either is missing or not a string.

    Both are required. Without a lesson there is no partition to count a cohort in, and
    without a pseudonym there is no identity to count — and the fallback the session reader
    would use in its place is the stream's own file path.
    """
    pseudonym = event.get("learner_pseudonym")
    lesson = event.get("lesson_id")
    if not (isinstance(pseudonym, str) and pseudonym):
        return None
    if not (isinstance(lesson, str) and lesson):
        return None
    return pseudonym, lesson


def _scene_of(event: Mapping[str, Any]) -> str | None:
    scene = event.get("scene_id")
    return scene if isinstance(scene, str) and scene else None


def _scan_common(scan: _Scan, event: Mapping[str, Any]) -> tuple[str, str] | None:
    identity = _identity(event)
    if identity is None:
        scan.unknown_identity = True
        return None
    pseudonym, lesson = identity
    scan.participants[lesson].add(pseudonym)
    version = event.get("bundle_version")
    scan.scopes.add((lesson, version if isinstance(version, str) and version else UNVERSIONED))
    return pseudonym, lesson


def _scan_collector_event(scan: _Scan, event: Mapping[str, Any]) -> None:
    """The contributors of each event the collector's four aggregations consume."""
    identity = _scan_common(scan, event)
    if identity is None:
        return
    pseudonym, lesson = identity
    kind = event.get("type")
    scene = _scene_of(event)
    if kind == "scene_completed" and scene:
        scan.contributor("progress", "scene_completed", (scene, lesson), pseudonym)
    elif kind == "lesson_completed":
        scan.contributor("course_completion", "lesson_completed", (lesson,), pseudonym)
    elif kind == "critique_submitted":
        # The collector's own scope rule, imported: `explain_back` is a comprehension
        # signal and its reader drops it, so it cannot enlarge the eligible cohort either.
        if metrics._is_autonomy_critique(event):
            scan.contributor("autonomy", "n_critique", (lesson,), pseudonym)
    elif kind == "adaptation_applied" and event.get("signal") == "hint":
        scan.contributor("autonomy", "n_hints", (lesson,), pseudonym)
    elif kind == "ai_audit_result" and scene:
        scan.contributor("trust", "ai_audit_result", (scene, lesson), pseudonym)


def _scan_sessions_event(scan: _Scan, event: Mapping[str, Any]) -> None:
    """The contributors of each event `build_report`'s three published values consume."""
    identity = _scan_common(scan, event)
    if identity is None:
        return
    pseudonym, lesson = identity
    kind = event.get("type")
    scene = _scene_of(event)
    if kind == "lesson_started":
        scan.contributor("completion", "lesson_started", (lesson,), pseudonym)
    elif kind == "lesson_completed":
        scan.contributor("completion", "lesson_completed", (lesson,), pseudonym)
        if isinstance(event.get("autonomy_ratio"), (int, float)):
            scan.contributor("autonomy", "autonomy_ratio", (lesson,), pseudonym)
    elif kind == "ai_audit_result" and scene:
        scan.contributor("trust", "ai_audit_result", (scene, lesson), pseudonym)


def _scan_files(files: Iterable[Path], root: Path,
                on_event: Callable[[_Scan, Mapping[str, Any]], None]) -> _Scan:
    """Scan every file the reader would read, stopping at the first that is not readable.

    Containment first, on every file: `_within` follows the links on both sides, so a
    JSONL or telemetry symlink pointing out of the configured root is refused BEFORE its
    reader is invoked. Neither reader could be stopped afterwards — `build_report`
    discovers its own input.
    """
    scan = _Scan()
    for path in files:
        if not _within(root, path):
            LOGGER.warning("observatory sessions: %s leaves the root %s; not read", path, root)
            scan.unreadable = _marker(path.name, "leaves the configured root")
            return scan
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            LOGGER.warning("observatory sessions: %s unreadable (%s: %s)", path,
                           type(exc).__name__, exc)
            scan.unreadable = _marker(path.name, type(exc).__name__)
            return scan
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                LOGGER.warning("observatory sessions: %s has an unparsable line (%s)", path, exc)
                scan.unreadable = _marker(path.name, type(exc).__name__)
                return scan
            if not isinstance(event, Mapping):
                LOGGER.warning("observatory sessions: %s has a line of type %s, not an object",
                               path, type(event).__name__)
                scan.unreadable = _marker(
                    path.name, f"a line is not an object but a {type(event).__name__}")
                return scan
            on_event(scan, event)
    return scan


# --------------------------------------------------------------------------------------
# the floors: one per cohort, then one per metric family
# --------------------------------------------------------------------------------------


def _cohort_state(scan: _Scan, floor: int, label: str) -> tuple[str, str | None]:
    """The state of a source's cohort, before any metric is considered."""
    if scan.unknown_identity:
        return "suppressed", (
            f"unknown identity: at least one event on the {label} carries no "
            f"learner_pseudonym or no lesson_id, so no cohort can be established. A "
            f"pseudonym is HMAC(learnerId:lessonId) — a person within ONE lesson — and a "
            f"stream's own file path is not a substitute for one.")
    if not scan.participants:
        return "empty", f"no telemetry event on the {label}"
    if any(len(ids) < floor for ids in scan.participants.values()):
        return "suppressed", (
            f"k-anonymity floor: every lesson needs at least {floor} distinct learners, and at "
            f"least one of the {len(scan.participants)} lesson(s) on the {label} has fewer. "
            f"Because a pseudonym is salted per lesson, a union across lessons counts "
            f"learner-lesson pairs and cannot lift a lesson over the floor. Exact counts are "
            f"withheld.")
    return "ok", None


def _live_terms(scan: _Scan, family: str) -> list[tuple[tuple[str, ...], set[str]]]:
    return [(key, ids) for term in scan.terms.get(family, {}).values()
            for key, ids in term.items() if ids]


def _family_state(scan: _Scan, family: str, floor: int, label: str, what: str,
                  per_scene: bool = False) -> tuple[str, set[str], str | None]:
    """`(status, display keys below the floor, reason)` for one metric family.

    A family is measured when at least one of the events its reader consumes was emitted,
    and publishable when every population it was computed over — each term, in each lesson,
    and for a scene-based value in each scene — has at least `floor` distinct contributors.
    """
    live = _live_terms(scan, family)
    if not live:
        return "unmeasured", set(), f"not measured: the {label} carries no {what}"
    short = {key[0] for key, ids in live if len(ids) < floor}
    if not short:
        return "ok", set(), None
    scope = "in every lesson and in every scene" if per_scene else "in every lesson"
    return "suppressed", short, (
        f"k-anonymity floor: {what} needs at least {floor} distinct contributing learners "
        f"{scope} on the {label}, and at least one population has fewer. Exact counts are "
        f"withheld.")


def _family(status: str, reason: str | None, payload: Mapping[str, Any] | None = None) -> dict:
    """A family carries its numbers only when it is `ok`.

    Anything else carries a status and the reason for it, and no key an operator (or a
    reader of the JSON twin) could mistake for a measurement.
    """
    if status == "ok":
        return {"status": status, "reason": reason, **dict(payload or {})}
    return {"status": status, "reason": reason}


def _people(count: Any, single_lesson: bool) -> dict[str, Any]:
    """A count of distinct pseudonyms, labelled for what it actually is.

    Within one lesson it is a count of people. Across lessons the same human holds one
    pseudonym per lesson, so the sum is a count of learner-lesson pairs — and it is never
    relabelled as people (`metrics.compute_course_completion`'s honesty boundary).
    """
    number = count if isinstance(count, int) else None
    return {"n_learners": number if single_lesson else None,
            "n_learner_lesson_pairs": number}


# --------------------------------------------------------------------------------------
# the collector store column
# --------------------------------------------------------------------------------------


def _store_children(cfg: ObservatoryConfig) -> dict[str, Path]:
    """The store's course directories, by name. Containment before the scan: a child that
    resolves outside the configured store is not listed, so it is not routable either."""
    root = cfg.analytics_data_dir
    if root is None or not root.is_dir():
        return {}
    try:
        children = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name)
    except OSError as exc:
        LOGGER.warning("observatory sessions: store root %s unreadable (%s)", root,
                       type(exc).__name__)
        return {}
    kept = {}
    for path in children:
        if _within(root, path):
            kept[path.name] = path
        else:
            LOGGER.warning("observatory sessions: store child %s leaves %s; not listed",
                           path.name, root)
    return kept


def store_courses(cfg: ObservatoryConfig) -> tuple[str, ...]:
    """Sorted course directory names of the collector store: the ONLY map a URL id is
    resolved through, so no path segment from a request is ever joined to a root. `()`
    when no store is configured."""
    return tuple(_store_children(cfg))


def _blank(column: dict, status: str, reason: str) -> dict:
    """The column, with every measurement removed.

    Applied to every state but `ok`. A suppressed column holds no number at all: not the
    cohort size (which `build_report`'s own suppressed shape returns), not a rate, not a
    scene. `status` and `reason` are what is left, and they name the floor and the source.
    """
    blanked = dict(column)
    blanked["status"] = status
    blanked["reason"] = reason
    for key, value in column.items():
        if key in ("status", "reason", "reader", "store", "root", "course", "scope_note"):
            continue
        if isinstance(value, dict) and "status" in value:
            blanked[key] = _family(status, reason)
        elif key == "report" and isinstance(value, dict):
            blanked[key] = {k: (_family(status, reason) if isinstance(v, dict) else None)
                            for k, v in value.items()}
        else:
            blanked[key] = None
    return blanked


def _scope_view(scan: _Scan, label: str) -> dict[str, Any]:
    """The one artifact scope a comparison may use, and why there is none when there is not.

    A comparison needs exactly one identical `(lesson_id, bundle_version)` on both sides.
    A lesson id alone is not globally unique, and `"unversioned"` is what the collector
    buckets an unstamped event under — not a version anything can be compared across.
    """
    scopes = sorted(scan.scopes)
    if not scopes:
        return {"scope": None, "n_scopes": 0,
                "scope_note": f"the {label} carries no (lesson_id, bundle_version) scope"}
    if len(scopes) > 1:
        return {"scope": None, "n_scopes": len(scopes),
                "scope_note": f"the {label} spans {len(scopes)} (lesson_id, bundle_version) "
                              f"scopes, so it is not a view of one artifact"}
    lesson, version = scopes[0]
    if version == UNVERSIONED:
        return {"scope": None, "n_scopes": 1,
                "scope_note": f'the {label}\'s only scope has bundle_version "{UNVERSIONED}" '
                              f"— the bucket for an event the runtime never stamped, not a "
                              f"version"}
    return {"scope": [lesson, version], "n_scopes": 1,
            "scope_note": f"one artifact scope: lesson_id={lesson}, bundle_version={version}"}


def collector_column(cfg: ObservatoryConfig, course: str | None) -> dict:
    """The collector store's half of the pair, for one course token.

    The token *is* the course id (INT-STUDIUM-019) and it is resolved through
    `store_courses` only.
    """
    base: dict[str, Any] = {
        "status": "absent", "store": None, "course": course, "reader": COLLECTOR_READER,
        "n_learners": None, "n_learner_lesson_pairs": None, "n_lessons": None, "lessons": None,
        "scope": None, "n_scopes": None, "scope_note": None,
        "progress": _family("absent", None), "course_completion": _family("absent", None),
        "autonomy": _family("absent", None), "trust": _family("absent", None), "reason": None,
    }
    root = cfg.analytics_data_dir
    if root is None:
        return _blank(base, "absent",
                      f"not configured — set {ENV_ANALYTICS_DATA_DIR} to the absolute "
                      f"directory the collector writes")
    base["store"] = str(root)
    if not root.is_dir():
        return _blank(base, "absent", f"the configured {ENV_ANALYTICS_DATA_DIR} is not a "
                                      f"directory")
    if course is None:
        return _blank(base, "absent",
                      "the collector store is partitioned by course token, so this column "
                      "needs a course; the session runs column does not have one to give "
                      "(see the scope note)")
    children = _store_children(cfg)
    if course not in children:
        return _blank(base, "absent",
                      f"no such course directory under {ENV_ANALYTICS_DATA_DIR}")

    course_dir = children[course]
    scan = _scan_files(sorted(course_dir.glob("*.jsonl")), root, _scan_collector_event)
    if scan.unreadable is not None:
        return _blank(base, "unreadable", scan.unreadable)
    state, reason = _cohort_state(scan, cfg.min_learners, COLLECTOR_LABEL)
    if state != "ok":
        return _blank(base, state, reason or "")

    single = len(scan.participants) == 1
    base.update(_scope_view(scan, COLLECTOR_LABEL))
    base["status"] = "ok"
    base["lessons"] = sorted(scan.participants)
    base["n_lessons"] = len(scan.participants)
    base.update(_people(sum(len(ids) for ids in scan.participants.values()), single))
    base["progress"] = _collector_progress(cfg, root, course, scan, single)
    base["course_completion"] = _collector_completion(cfg, root, course, scan)
    base["autonomy"] = _collector_autonomy(cfg, root, course, scan)
    base["trust"] = _collector_trust(cfg, root, course, scan)
    return base


def _collector_progress(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan,
                        single: bool) -> dict:
    """Per-scene completion, scene by scene: a scene whose completions come from fewer
    than `min_learners` people is not shown, and the ones that do are."""
    state, short, reason = _family_state(scan, "progress", cfg.min_learners, COLLECTOR_LABEL,
                                         "per-scene progress", per_scene=True)
    if state == "unmeasured":
        return _family(state, reason)
    scenes_read = metrics.compute_progress(root, course).get("scenes") or {}
    scenes = {}
    for scene_id, row in scenes_read.items():
        if scene_id in short:
            continue
        row = row if isinstance(row, Mapping) else {}
        scenes[scene_id] = {"completion_rate": row.get("completion_rate"),
                            **_people(row.get("n_learners"), single)}
    if not scenes:
        return _family("suppressed", reason)
    withheld = (f"{len(short)} scene(s) withheld: fewer than {cfg.min_learners} distinct "
                f"contributing learners" if short else None)
    return _family("ok", withheld, {"scenes": scenes, "n_withheld_scenes": len(short)})


def _collector_completion(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan) -> dict:
    """Distinct completers per lesson — a count of people, since it is within a lesson.
    The `total_completions` sum is all-or-nothing: published only when no lesson is
    withheld, since otherwise it states what the withheld lesson contributed."""
    state, short, reason = _family_state(scan, "course_completion", cfg.min_learners,
                                         COLLECTOR_LABEL, "lesson completions")
    if state == "unmeasured":
        return _family(state, reason)
    read = metrics.compute_course_completion(root, course)
    lessons = {lesson_id: {"n_completed": (row or {}).get("n_completed")}
               for lesson_id, row in (read.get("lessons") or {}).items()
               if lesson_id not in short}
    if not lessons:
        return _family("suppressed", reason)
    withheld = (f"{len(short)} lesson(s) withheld: fewer than {cfg.min_learners} distinct "
                f"contributing learners" if short else None)
    return _family("ok", withheld,
                   {"lessons": lessons, "n_withheld_lessons": len(short),
                    "total_completions": None if short else read.get("total_completions")})


def _collector_autonomy(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan) -> dict:
    """One ratio over the whole course, so it is all-or-nothing: both of its populations —
    the AI-critique submissions and the hint adaptations — need a cohort."""
    state, _short, reason = _family_state(scan, "autonomy", cfg.min_learners, COLLECTOR_LABEL,
                                         "AI-critique submissions and hint adaptations")
    if state != "ok":
        return _family(state, reason)
    read = metrics.compute_autonomy(root, course)
    return _family("ok", None, {key: read.get(key) for key in
                                ("autonomy_ratio", "critique_completion_rate",
                                 "n_critique", "n_hints")})


def _collector_trust(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan) -> dict:
    """The trust summary, without the raw per-scene payload the reader also returns."""
    state, _short, reason = _family_state(scan, "trust", cfg.min_learners, COLLECTOR_LABEL,
                                          "grounded audits", per_scene=True)
    if state != "ok":
        return _family(state, reason)
    read = metrics.compute_trust_calibration(root, course)
    return _family("ok", None, {key: read.get(key) for key in
                                ("trust_calibration", "band", "n_audits", "over_trust",
                                 "over_distrust")})


# --------------------------------------------------------------------------------------
# the session runs column
# --------------------------------------------------------------------------------------


def sessions_column(cfg: ObservatoryConfig) -> dict:
    """The session runs' half of the pair: ONE directory, read whole, with no course."""
    base: dict[str, Any] = {
        "status": "absent", "root": None, "reader": SESSIONS_READER,
        "n_streams": None, "n_learners": None, "n_learner_lesson_pairs": None,
        "n_lessons": None, "lessons": None,
        "scope": None, "n_scopes": None, "scope_note": None,
        "report": {"n_learners": None, "n_learner_lesson_pairs": None, "n_streams": None,
                   "completion": _family("absent", None), "autonomy": _family("absent", None),
                   "trust": _family("absent", None)},
        "reason": None,
    }
    root = cfg.sessions_root
    if root is None:
        return _blank(base, "absent",
                      f"not configured — set {ENV_SESSIONS_ROOT} to the one directory of "
                      f"telemetry streams to read")
    base["root"] = str(root)
    if not root.is_dir():
        return _blank(base, "absent", f"the configured {ENV_SESSIONS_ROOT} is not a directory")

    scan = _scan_files(sorted(root.rglob("telemetry.jsonl")), root, _scan_sessions_event)
    if scan.unreadable is not None:
        return _blank(base, "unreadable", scan.unreadable)
    state, reason = _cohort_state(scan, cfg.min_learners, SESSIONS_LABEL)
    if state != "ok":
        return _blank(base, state, reason or "")

    report = build_report(root, min_learners=cfg.min_learners)
    if report.get("status") != "ok":
        # Unreachable while the preflight holds (every lesson is over the floor, so the
        # union is too), and not passed through if it ever is: that shape returns the exact
        # cohort size and the stream count.
        LOGGER.warning("observatory sessions: build_report returned %r after a passing "
                       "preflight", report.get("status"))
        return _blank(base, "suppressed",
                      f"the class report withheld its own result at the {cfg.min_learners}-learner "
                      f"floor; no count is shown")

    single = len(scan.participants) == 1
    pairs = _people(report.get("n_learners"), single)
    base.update(_scope_view(scan, SESSIONS_LABEL))
    base["status"] = "ok"
    base["lessons"] = sorted(scan.participants)
    base["n_lessons"] = len(scan.participants)
    base["n_streams"] = report.get("n_streams")
    base.update(pairs)
    base["report"] = {
        **pairs, "n_streams": report.get("n_streams"),
        "completion": _sessions_completion(cfg, report, scan),
        "autonomy": _sessions_autonomy(cfg, report, scan),
        "trust": _sessions_trust(cfg, report, scan),
    }
    return base


def _sessions_completion(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan) -> dict:
    state, _short, reason = _family_state(scan, "completion", cfg.min_learners, SESSIONS_LABEL,
                                          "lesson starts and completions")
    if state != "ok":
        return _family(state, reason)
    return _family("ok", None, {"completion_rate": report.get("completion_rate")})


def _sessions_autonomy(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan) -> dict:
    state, _short, reason = _family_state(scan, "autonomy", cfg.min_learners, SESSIONS_LABEL,
                                          "lesson completions carrying an autonomy_ratio")
    if state != "ok":
        return _family(state, reason)
    return _family("ok", None, {"mean_autonomy": report.get("mean_autonomy")})


def _sessions_trust(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan) -> dict:
    """The class report's trust summary, without its `scenes` list."""
    state, _short, reason = _family_state(scan, "trust", cfg.min_learners, SESSIONS_LABEL,
                                          "grounded audits", per_scene=True)
    if state != "ok":
        return _family(state, reason)
    section = report.get("trust_calibration")
    section = section if isinstance(section, Mapping) else {}
    return _family("ok", None, {key: section.get(key)
                                for key in ("measured", "n_scenes", "gap", "band")})


# --------------------------------------------------------------------------------------
# the pair
# --------------------------------------------------------------------------------------

#: The families that measure the same construct on both sides. A number withheld on one
#: side and shown on the other is the withheld one, by subtraction, so the pair moves
#: together.
_PAIRED_FAMILIES = (("trust", "trust"), ("course_completion", "completion"),
                    ("autonomy", "autonomy"))

_STATE_WORDS = {
    "unmeasured": "not measured",
    "suppressed": "withheld by the k-anonymity floor",
    "absent": "absent",
    "unreadable": "unreadable",
    "empty": "empty",
}


def _pair_families(collector: dict, sessions: dict) -> None:
    """Suppress a family whose pair on the other source is suppressed. In place, on two
    columns that are both `ok` — there is nothing to protect against when the other source
    is absent, unreadable or suppressed as a whole."""
    if collector.get("status") != "ok" or sessions.get("status") != "ok":
        return
    for collector_key, sessions_key in _PAIRED_FAMILIES:
        left = collector[collector_key]
        right = sessions["report"][sessions_key]
        if left["status"] == "suppressed" and right["status"] != "suppressed":
            sessions["report"][sessions_key] = _family(
                "suppressed", f"suppressed with its pair on the {COLLECTOR_LABEL}, which "
                              f"withheld the same family at the k-anonymity floor")
        elif right["status"] == "suppressed" and left["status"] != "suppressed":
            collector[collector_key] = _family(
                "suppressed", f"suppressed with its pair on the {SESSIONS_LABEL}, which "
                              f"withheld the same family at the k-anonymity floor")


def _trust_pair(collector: dict, sessions: dict) -> tuple[dict, dict] | None:
    """The two trust families when both are publishable numbers, else None."""
    left = collector["trust"]
    right = sessions["report"]["trust"]
    if left["status"] != "ok" or right["status"] != "ok":
        return None
    if left.get("trust_calibration") is None or right.get("measured") is not True:
        return None
    return left, right


def _not_compared(collector: dict, sessions: dict, indicator: str) -> dict:
    left = collector["trust"]["status"]
    right = sessions["report"]["trust"]["status"]
    left_word = _STATE_WORDS.get(left, left)
    right_word = _STATE_WORDS.get(right, right)
    if left == "ok" and right == "ok":
        left_word = right_word = "not measured"
    return {"indicator": indicator, "collector": None, "sessions": None, "comparable": False,
            "diverges": None,
            "note": f"not compared: trust is {left_word} on the {COLLECTOR_LABEL} and "
                    f"{right_word} on the {SESSIONS_LABEL}. An absent number reads as "
                    f"\"not measured here\", never as agreement."}


def divergences(collector: dict, sessions: dict) -> list[dict]:
    """The rows that are like-for-like, or none at all.

    Computed only when both columns are `ok` AND both name exactly one identical
    `(lesson_id, bundle_version)` scope. Anything else renders the two columns
    independently: an alarm raised across two different artifacts, or across a scope that
    cannot be established, is an alarm about the scope and not about the data.
    """
    if collector.get("status") != "ok" or sessions.get("status") != "ok":
        return []
    scope = collector.get("scope")
    if not scope or scope != sessions.get("scope"):
        return []

    rows = [{"indicator": "n_learners",
             "collector": collector.get("n_learners"), "sessions": sessions.get("n_learners"),
             "comparable": True,
             "diverges": collector.get("n_learners") != sessions.get("n_learners"),
             "note": "distinct learner_pseudonym values within one lesson scope, so a count "
                     "of people on both sides"}]
    pair = _trust_pair(collector, sessions)
    if pair is None:
        rows += [_not_compared(collector, sessions, "trust_gap"),
                 _not_compared(collector, sessions, "trust_band")]
        return rows
    left, right = pair
    gap_left = float(left["trust_calibration"])
    gap_right = float(right["gap"])
    rows.append({"indicator": "trust_gap", "collector": gap_left, "sessions": gap_right,
                 "comparable": True,
                 "diverges": abs(gap_left - gap_right) > GAP_TOLERANCE,
                 "note": f"over_trust - over_distrust over the same grounded audits; equal "
                         f"within {GAP_TOLERANCE} (the class report rounds to 3 decimals)"})
    rows.append({"indicator": "trust_band", "collector": left.get("band"),
                 "sessions": right.get("band"), "comparable": True,
                 "diverges": left.get("band") != right.get("band"),
                 "note": "the same bands, from the same TRUST_WELL_BAND: compared exactly"})
    return rows


def _comparison(collector: dict, sessions: dict) -> dict:
    """Whether the pair is comparable at all, and the reason when it is not."""
    for column, label in ((collector, COLLECTOR_LABEL), (sessions, SESSIONS_LABEL)):
        if column.get("status") != "ok":
            state = column.get("status")
            return {"status": "incomparable", "scope": None,
                    "reason": f"no comparison: the {label} column is "
                              f"{_STATE_WORDS.get(state, state)}"}
    left, right = collector.get("scope"), sessions.get("scope")
    if not left or not right:
        return {"status": "incomparable", "scope": None,
                "reason": f"no comparison: {collector.get('scope_note')}; "
                          f"{sessions.get('scope_note')}"}
    if left != right:
        return {"status": "incomparable", "scope": None,
                "reason": f"no comparison: the two sources are different artifacts — the "
                          f"{COLLECTOR_LABEL} has lesson_id={left[0]}, bundle_version={left[1]} "
                          f"and the {SESSIONS_LABEL} has lesson_id={right[0]}, "
                          f"bundle_version={right[1]}. A lesson id alone is not unique, so "
                          f"nothing is paired and nothing is flagged."}
    return {"status": "comparable", "scope": left,
            "reason": f"one shared artifact scope: lesson_id={left[0]}, "
                      f"bundle_version={left[1]}"}


def sessions_detail(cfg: ObservatoryConfig, course: str | None) -> dict:
    """Both columns, their comparison and the reasons for everything that is not shown."""
    collector = collector_column(cfg, course)
    sessions = sessions_column(cfg)

    # One floor over the pair: a source that may not be shown takes the other with it, so
    # the shown one cannot be differenced against the withheld one. A source that is
    # absent or unreadable withholds nothing, and leaves the other independently readable.
    def with_the_other(label: str) -> str:
        return (f"suppressed with the {label}, which has a population below the "
                f"{cfg.min_learners}-learner floor: shown alone, this column would leave the "
                f"withheld numbers as its difference")

    if collector["status"] == "suppressed" and sessions["status"] == "ok":
        sessions = _blank(sessions, "suppressed", with_the_other(COLLECTOR_LABEL))
    elif sessions["status"] == "suppressed" and collector["status"] == "ok":
        collector = _blank(collector, "suppressed", with_the_other(SESSIONS_LABEL))
    _pair_families(collector, sessions)

    comparison = _comparison(collector, sessions)
    notes = [SESSION_SCOPE_NOTE, comparison["reason"]]
    for column, label in ((collector, COLLECTOR_LABEL), (sessions, SESSIONS_LABEL)):
        if column["status"] != "ok" and column.get("reason"):
            notes.append(f"{label}: {column['reason']}")
    return {"course": course, "collector": collector, "sessions": sessions,
            "divergences": divergences(collector, sessions),
            "shown_not_flagged": list(SHOWN_NOT_FLAGGED), "comparison": comparison,
            "min_learners": cfg.min_learners, "notes": notes}
