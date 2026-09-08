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
``broken``      this projection called a reader wrongly; the source was never read.
``ok``          the reader ran; each metric family then answers for itself.

`ok` is the state INT-STUDIUM-030's R1 narrows: it means a NUMBER WAS COMPUTED over the
stated population, not merely that the family ran. So a family that ran and computed nothing
carries `measured: false` and the reason the null is itself the measurement, and a judgement
family names the population it rests on as a BAND (`5-9 / 10-19 / 20+`) rather than an exact
count that moves on every new contributor. What was withheld is stated as one boolean per
reason, never as a total: an integer there is monotone as a course grows and is read against
a roster the teacher already holds.

`_within` is `observatory_discovery`'s containment rule and `_is_autonomy_critique` is the
collector's own scope predicate. Both are private names of their modules, imported here
deliberately rather than copied: a second copy of a containment check or of a scene-type
rule is how the two `autonomy_ratio` definitions came to disagree in the first place.
"""
from __future__ import annotations

import json
import logging
import math
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any

from observatory_config import ENV_ANALYTICS_DATA_DIR, ENV_SESSIONS_ROOT, ObservatoryConfig
from observatory_discovery import _within  # noqa: F401  (the containment rule of the roots)
from observatory_paths import ensure_importable

ensure_importable()

import metrics  # noqa: E402  (the collector's own aggregations, and its scope predicate)
from class_report import (  # noqa: E402  (the runtime-side class report)
    AUTONOMY_INDICATOR_NAME as _SESSIONS_AUTONOMY_NAME,
    build_report,
)

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

#: INT-STUDIUM-030 call 1 — the edges of the bands a JUDGEMENT cohort is coarsened to.
#: Trust calibration, over-trust, over-distrust and autonomy are characterological readings.
#: An exact contributor count beside one moves on every new contributor — roughly twenty
#: transitions over a class, each an event a patient reader can time against a roster they
#: already hold, which is R2's second clause exactly. A band moves twice. R1 still holds, and
#: that is why a band is published rather than a bare `>= floor`: `>= floor` names no
#: population, so a reading resting on five contributors and one resting on twenty-four would
#: arrive identical and be given the same weight.
_BAND_EDGES = (10, 20)

#: The sentence every judgement metric carries, on both twins. The teacher dashboard states
#: the same thing in its own voice (`apps/teacher-dashboard/components/NonAttribution.tsx`);
#: this is the operator page's. The unit of protection is the individual, and the surface says
#: so in words rather than implying it through a floor.
NON_ATTRIBUTION = (
    "class-level reading over the contributors this family names, and not a statement about "
    "any student: it describes how a group judged, and no control on this surface narrows it "
    "to a person")

#: The sentence the operator needs next to the `{course}` in the URL.
SESSION_SCOPE_NOTE = (
    "No writer of a telemetry stream stamps a course: the durable host tree is keyed by "
    "pseudonym (<pseudonym>/<bundle_id>/telemetry.jsonl) and an eval run's by persona. The "
    "session runs column is therefore the whole configured directory, and the course in the "
    "URL scopes the collector store column only.")

#: INT-STUDIUM-023 — the two operator-facing names for the two ratios that the two readers
#: both return as `autonomy_ratio`. Neither wire key moves; what is separated is the name.
#: Read from the two definition sites, so this page, its JSON twin and the two computations
#: cannot drift apart — the drift is the defect.
INDICATOR_NAMES: dict[str, str] = {
    "collector_autonomy": metrics.AUTONOMY_INDICATOR_NAME,
    "sessions_autonomy": _SESSIONS_AUTONOMY_NAME,
}

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
        "collector": f"{INDICATOR_NAMES['collector_autonomy']} — compute_autonomy: "
                     "n_critique / (n_critique + n_hints), where n_critique counts "
                     "`critique_submitted` from AI-critique scenes only and n_hints counts "
                     "`adaptation_applied` with signal \"hint\" (the scaffolding modulator) "
                     "— a class-level ratio of events.",
        "sessions": f"{INDICATOR_NAMES['sessions_autonomy']} — build_report: the mean of the "
                    "`autonomy_ratio` scalar the runtime stamps on each `lesson_completed` "
                    "(scenes completed / scenes completed + scaffolding) — a mean of "
                    "per-session values computed on the device.",
        "why_not_flagged": "Two measurements that arrive under the wire key `autonomy_ratio` "
                           "and share no formula. Neither key is renamed — historical streams "
                           "carry it — so the two are separated by the names above "
                           "(INT-STUDIUM-023), and a difference between them is the "
                           "definition, not a fault.",
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
                  per_scene: bool = False,
                  requires: tuple[str, ...] = ()) -> tuple[str, set[str], str | None]:
    """`(status, display keys below the floor, reason)` for one metric family.

    A family is measured when at least one of the events its reader consumes was emitted,
    and publishable when every population it was computed over — each term, in each lesson,
    and for a scene-based value in each scene — has at least `floor` distinct contributors.
    """
    live = _live_terms(scan, family)
    if not live:
        return "unmeasured", set(), f"not measured: the {label} carries no {what}"
    for term in requires:
        if not any(ids for ids in scan.terms.get(family, {}).get(term, {}).values()):
            return "unmeasured", set(), (
                f"not measured: {what} divides by the {term} population, and the {label} "
                f"carries no contributor to it. A ratio over nobody is not a zero that was "
                f"measured.")
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


def _cohort_band(size: int, floor: int) -> str:
    """A judgement cohort's size as a band: `5-9`, `10-19`, `20+` at the default floor of 5.

    The lowest band starts at the floor, because a cohort under the floor was never
    published, and each later band starts at its edge. What the reader gains is the order of
    magnitude that makes a judgement metric interpretable; what they lose is the per-read
    increment that makes an exact count a channel.
    """
    lower = floor
    for edge in _BAND_EDGES:
        if size < edge:
            return f"{lower}\u2013{edge - 1}"
        lower = max(edge, floor)
    return f"{lower}+"


def _judgement(scan: _Scan, family: str, floor: int, single: bool) -> dict[str, Any]:
    """What a judgement family publishes about its population, and about itself.

    R1 requires every published number to name the population it was computed over. For a
    judgement metric that population is named as a band and as the UNIT the band counts,
    because a pseudonym is `HMAC(learnerId:lessonId)`: within one lesson these are people,
    and across lessons the same human holds one per lesson, so the union counts
    learner-lesson pairs and is never relabelled as people.
    """
    contributors = {pseudonym for _key, members in _live_terms(scan, family)
                    for pseudonym in members}
    return {"cohort_band": _cohort_band(len(contributors), floor),
            "cohort_counts": "distinct learners within one lesson" if single
                             else "learner-lesson pairs across the lessons in scope",
            "non_attribution": NON_ATTRIBUTION}


def _finite(value: Any) -> float | None:
    """`value` as a finite float, or None when it is not one.

    `bool` is excluded deliberately: `True` is an `int` in Python, so an unguarded numeric
    check reads a `true` in a numeric field as the measurement `1.0`. A string is excluded
    for the same reason `float("nan")` must not be trusted: it succeeds.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _measured(read: Mapping[str, Any], numeric: tuple[str, ...],
              other: tuple[str, ...] = ()) -> tuple[dict[str, Any] | None, str | None]:
    """The reader's own values, or the reason the family cannot publish any of them.

    A number that is present but not finite has measured nothing an operator can read, and
    the two twins do not even agree about it: pydantic serialises it to `null`, which cannot
    be told from a family that ran and found nothing, while `"%.4g"` puts the literal `nan`
    on the page. The FIELD is named, never the value (amendment 4).

    `None` is passed through here and decided by `_value_state`, which is the half of the
    question this function used to decline: a shape that says a value is absent is not a
    MALFORMED one, but under R1 it is not a measured one either, and `ok` beside it has to
    say which.
    """
    payload: dict[str, Any] = {}
    for key in numeric:
        value = read.get(key)
        if value is not None and _finite(value) is None:
            return None, f"unreadable: {key} is not a finite number"
        payload[key] = value
    for key in other:
        payload[key] = read.get(key)
    return payload, None


def _value_state(payload: dict[str, Any], headline: tuple[str, ...],
                 reasons: Mapping[str, str],
                 secondary: tuple[str, ...] = ()) -> tuple[dict[str, Any], str | None]:
    """`measured`, and the reason when a `null` under `ok` is itself the measurement.

    `status: ok` used to mean "the family ran". Under INT-STUDIUM-030's R1 it means a number
    was computed over the stated population, so a family that ran and computed nothing says
    so rather than letting an absent value stand as one — the shape INT-STUDIUM-029 filed and
    this intent supersedes. Two instances are reachable today: `completion_rate` when no
    lesson was started, and the trust families when every audit is ungrounded.

    `measured` is computed from the values actually published here and never copied from a
    reader's own flag. A reader that claims `measured: true` beside a `null` is the defect,
    not the authority on it.

    `secondary` is for a field whose absence is a measurement of its own without unmaking the
    family's — `over_distrust` is `None` exactly when no scene offered a sound claim, so a
    false alarm was never possible (`metrics.compute_trust_calibration`'s honesty boundary).
    It is named in the reason and it does not flip `measured`, because deleting the gap that
    WAS measured in order to report the one that was not is the symmetric-guard trap
    INT-STUDIUM-026 names.
    """
    def stated(keys: list[str]) -> str:
        return "; ".join(reasons.get(key, f"{key} was not computed") for key in keys)

    missing = [key for key in headline if payload.get(key) is None]
    aside = [key for key in secondary if payload.get(key) is None]
    parts = [stated(keys) for keys in (missing, aside) if keys]
    return {**payload, "measured": not missing}, ("; ".join(parts) or None)


def _call_site_type_error(exc: BaseException) -> bool:
    """True when a `TypeError` came from the CALL, not from inside the reader.

    Python builds no frame for a callable whose arguments do not bind, so the deepest frame
    of such a traceback is the thunk this module passed in. A `TypeError` raised inside a
    reader has that reader's own frame below it.
    """
    tb = exc.__traceback__
    if tb is None:
        return False
    depth = 0
    while tb.tb_next is not None:
        tb = tb.tb_next
        depth += 1
    return depth <= 1


def _read(call: Callable[[], Any], what: str) -> tuple[Any, tuple[str, str] | None]:
    """Run one reader over telemetry that may hold anything.

    The preflight establishes that every line parses and is an object. It does not
    establish that a field holds the type its reader will pass to `int()`, and neither
    reader validates before it aggregates — so one wrong-typed field is an unreadable
    source, not a 500 for a page whose whole contract is to fail soft.

    The fault is returned as `(state, reason)`, and there are two states because there are
    two culprits. `unreadable` says the source is not what its reader can read. `broken` says
    this projection called the reader wrongly — INT-STUDIUM-030 files that as a nit against
    the old behaviour, which reported a call-site `TypeError` as
    "unreadable: <reader> raised TypeError" and so sent an operator to hunt through their own
    telemetry for a defect that is on this page.
    """
    try:
        document = call()
    except TypeError as exc:
        if _call_site_type_error(exc):
            LOGGER.error("observatory sessions: %s was called with arguments it does not "
                         "accept (%s)", what, exc)
            return None, ("broken", f"broken: this page called {what} with arguments it does "
                                    f"not accept, so the source was never read. The defect is "
                                    f"in this projection, not in the telemetry.")
        LOGGER.warning("observatory sessions: %s raised (TypeError: %s)", what, exc)
        return None, ("unreadable", f"unreadable: {what} raised TypeError")
    except Exception as exc:
        LOGGER.warning("observatory sessions: %s raised (%s: %s)", what, type(exc).__name__, exc)
        return None, ("unreadable", f"unreadable: {what} raised {type(exc).__name__}")
    if document is None:
        # No reader returns this today. Passing it back with no reason would send `None`
        # into the caller's `.get`, and the function written to prevent a 500 would raise
        # one — outside any `try`, on the same page.
        LOGGER.warning("observatory sessions: %s returned no document", what)
        return None, ("unreadable", f"unreadable: {what} returned no document")
    return document, None


def _withheld(kind: str, floor: int, below: int, unseen: int, unreadable: int) -> str | None:
    """Why a family published fewer keys than its reader returned — and never how many.

    Three different reasons, never merged into one count an operator would read as the floor
    alone: a cohort under the floor, a key the preflight never saw, and a key whose number
    came back unusable.

    The counts are gone from the sentence as well as from the payload (INT-STUDIUM-030, R2
    second clause). Moving `n_withheld_scenes` into prose would have left the channel exactly
    where it was: "3 scene(s) withheld" read once a week against a roster is the same monotone
    integer, and a boolean beside a sentence that contradicts it is worse than either alone.
    This is the treatment the same intent gave `class_report`'s suppressed path — the floor
    states itself and never the cohort.
    """
    parts = []
    if below:
        parts.append(f"at least one {kind} is withheld: fewer than {floor} distinct "
                     f"contributing learners. How many are withheld is not published, because "
                     f"that number grows with the class and can be read against a roster.")
    if unseen:
        # Not "arrived late": a key the scan rejected — a non-string id, say — was there all
        # along. What is true of every one of them is that no floor was ever applied to it.
        parts.append(f"at least one {kind} is withheld: in the reader's read and not in the "
                     f"cohort check's, so no floor was applied to it")
    if unreadable:
        parts.append(f"at least one {kind} is withheld: no finite completion_rate")
    return "; ".join(parts) or None


def _withheld_flags(below: int, unseen: int, unreadable: int) -> dict[str, bool]:
    """WHY keys were withheld, and never HOW MANY (INT-STUDIUM-030, R2 second clause).

    `n_withheld_scenes` and `n_withheld_lessons` were exactly the quantity that clause
    describes: an integer stating how many keys sit under the floor, monotone as a course
    grows, read against a roster the teacher already holds. Scene by scene, its increments
    time each withheld key to the lesson that produced it.

    One boolean per reason keeps what the counts existed for — a reader still cannot mistake
    a course of eight scenes for one of twelve, and still learns WHY a key is missing — and
    removes the increment. It also makes one disagreement unrepresentable: the integers summed
    three differently-caused populations while the prose `reason` beside them distinguished
    all three, so the number and the sentence could contradict each other.
    """
    return {"withheld_below_floor": bool(below), "withheld_unseen": bool(unseen),
            "withheld_unreadable": bool(unreadable)}


def _nothing_left(kind: str, short: set[str], floor_reason: str | None,
                  withheld: str | None) -> dict:
    """Nothing survived the filters, and the operator is owed the reason it did not.

    `suppressed` is the k-anonymity word everywhere else on this surface, so it is used
    only when a population really was under the floor — `short` is what says so, and
    `floor_reason` is the sentence `_family_state` already wrote for it. A key the
    preflight never scanned, or one whose value is not a finite number, is withheld for a
    reason of its own and must not borrow the floor's; and a reader that returns no key at
    all where the cohort check saw the events for one is a disagreement between two reads,
    which is neither.
    """
    if short:
        return _family("suppressed", floor_reason or "")
    return _family("withheld", withheld or (
        f"nothing to show: the {kind} reader returned no {kind} where the cohort check had "
        f"seen the events for one, so the two reads disagree about what exists"))


def _seen_keys(scan: _Scan, family: str) -> set[str]:
    """The display keys the preflight actually established a cohort for.

    The floor is decided on one read of a source and the numbers come from another: the
    collector appends to today's partition while the page is being served. A key that
    first appears in the reader's read is in no below-floor set, so publishing it publishes
    a count no floor was ever applied to.
    """
    return {key[0] for key, _ids in _live_terms(scan, family)}


#: Why a `null` under `ok` is the measurement, per family and per field. Written as whole
#: sentences because they are what an operator reads instead of a number (R1 at the value
#: level); a bare field name would only restate the `null`.
_UNMEASURED_REASONS: dict[str, str] = {
    "autonomy_ratio":
        "measured: false — the autonomy reader returned no ratio for this course, so there "
        "is no share of critiques over critiques-plus-hints to publish. The null is the "
        "measurement, not a zero that was computed.",
    "critique_completion_rate":
        "measured: false — no critique carried a completion_rate, so the rate divides by "
        "nobody.",
    "trust_calibration":
        "measured: false — no scene in this course carried a GROUNDED audit "
        "(planted_errors == 0 everywhere), so there is no over-trust to difference against "
        "over-distrust. The null is the measurement, not a well-calibrated zero.",
    "over_distrust":
        "over_distrust is null and that is a measurement of its own: no scene offered a sound "
        "claim, so a false alarm was never possible. Unmeasured, not zero — and the gap that "
        "WAS measured is published beside it rather than deleted with it.",
    "completion_rate":
        "measured: false — no lesson_started event is in this directory (n_started == 0), so "
        "the completion rate divides by nobody. The null is the measurement, not a course "
        "nobody finished.",
    "mean_autonomy":
        "measured: false — no lesson_completed in this directory carries an autonomy_ratio, "
        "so there is nothing to take a mean of.",
    "gap":
        "measured: false — no grounded audit in this directory, so the class report computed "
        "no trust gap. The null is the measurement.",
}


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
    """The column, with every measurement OF THE COHORT removed.

    Applied to every state but `ok`. A suppressed column holds no number about the people
    behind it: not the cohort size (which `build_report`'s own suppressed shape returns),
    not a rate, not a scene.

    What it keeps is source identification, and the artifact scope is part of that
    (INT-STUDIUM-026). `lesson_id` and `bundle_version` describe the ARTIFACT, not the
    cohort — they do not vary with who contributed — so they sit with `reader`, `store`,
    `root` and `course`. Before this, `scope_note` was kept while `scope` and `n_scopes`
    were nulled beside it, so a suppressed column carried a sentence naming a scope next
    to a field saying there was none: the JSON twin and its own prose disagreed. And
    under INT-STUDIUM-030's R1 an operator who cannot see WHICH lesson was suppressed
    cannot act on the suppression.
    """
    blanked = dict(column)
    blanked["status"] = status
    blanked["reason"] = reason
    for key, value in column.items():
        if key in ("status", "reason", "reader", "store", "root", "course",
                   "scope", "n_scopes", "scope_note"):
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
    base["autonomy"] = _collector_autonomy(cfg, root, course, scan, single)
    base["trust"] = _collector_trust(cfg, root, course, scan, single)
    return base


def _collector_progress(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan,
                        single: bool) -> dict:
    """Per-scene completion, scene by scene: a scene whose completions come from fewer
    than `min_learners` people is not shown, and the ones that do are."""
    state, short, reason = _family_state(scan, "progress", cfg.min_learners, COLLECTOR_LABEL,
                                         "per-scene progress", per_scene=True)
    if state == "unmeasured":
        return _family(state, reason)
    read, fault = _read(lambda: metrics.compute_progress(root, course),
                        "the per-scene progress reader")
    if fault is not None:
        return _family(*fault)
    scenes_read = read.get("scenes") or {}
    seen = _seen_keys(scan, "progress")
    scenes, unseen, unreadable_scenes = {}, [], []
    for scene_id, row in scenes_read.items():
        if scene_id in short:
            continue
        if scene_id not in seen:
            unseen.append(scene_id)
            continue
        row = row if isinstance(row, Mapping) else {}
        rate = row.get("completion_rate")
        if rate is not None and _finite(rate) is None:
            unreadable_scenes.append(scene_id)
            continue
        scenes[scene_id] = {"completion_rate": rate,
                            **_people(row.get("n_learners"), single)}
    withheld = _withheld("scene", cfg.min_learners, len(short), len(unseen),
                         len(unreadable_scenes))
    if not scenes:
        return _nothing_left("scene", short, reason, withheld)
    return _family("ok", withheld,
                   {"scenes": scenes,
                    **_withheld_flags(len(short), len(unseen), len(unreadable_scenes))})


def _collector_completion(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan) -> dict:
    """Distinct completers per lesson — a count of people, since it is within a lesson.
    The `total_completions` sum is all-or-nothing: published only when no lesson is
    withheld, since otherwise it states what the withheld lesson contributed."""
    state, short, reason = _family_state(scan, "course_completion", cfg.min_learners,
                                         COLLECTOR_LABEL, "lesson completions")
    if state == "unmeasured":
        return _family(state, reason)
    read, fault = _read(lambda: metrics.compute_course_completion(root, course),
                        "the lesson completion reader")
    if fault is not None:
        return _family(*fault)
    seen = _seen_keys(scan, "course_completion")
    lessons_read = read.get("lessons") or {}
    unseen = [lesson_id for lesson_id in lessons_read if lesson_id not in seen]
    lessons = {lesson_id: {"n_completed": (row or {}).get("n_completed")}
               for lesson_id, row in lessons_read.items()
               if lesson_id not in short and lesson_id in seen}
    incomplete = bool(short or unseen)
    withheld = _withheld("lesson", cfg.min_learners, len(short), len(unseen), 0)
    if not lessons:
        return _nothing_left("lesson", short, reason, withheld)
    if incomplete:
        # The null beside a withheld lesson gets its own sentence, for the same reason
        # `measured: false` does elsewhere: an absent number that does not say why it is
        # absent is read as a number.
        withheld += ("; total_completions is not shown: a total beside a withheld lesson "
                     "states what that lesson contributed, by subtraction")
    return _family("ok", withheld,
                   {"lessons": lessons, **_withheld_flags(len(short), len(unseen), 0),
                    "total_completions": None if incomplete else read.get("total_completions")})


def _collector_autonomy(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan,
                        single: bool) -> dict:
    """One ratio over the whole course, so it is all-or-nothing.

    `n_critique` is required and `n_hints` is not, because they sit in different places in
    the two formulas: `critique_completion_rate` divides by `n_critique` alone, so with no
    critiques it is a rate over nobody. `autonomy_ratio` divides by `n_critique + n_hints`,
    which one contributor to either already makes non-empty — and requiring hints would
    delete a real measurement from the course that needed none, under a sentence claiming
    the ratio was over nobody. Whichever populations are live still face the floor.
    """
    state, _short, reason = _family_state(scan, "autonomy", cfg.min_learners, COLLECTOR_LABEL,
                                         "AI-critique submissions and hint adaptations",
                                         requires=("n_critique",))
    if state != "ok":
        return _family(state, reason)
    read, fault = _read(lambda: metrics.compute_autonomy(root, course), "the autonomy reader")
    if fault is not None:
        return _family(*fault)
    payload, unreadable = _measured(read, ("autonomy_ratio", "critique_completion_rate",
                                           "n_critique", "n_hints"))
    if payload is None:
        return _family("unreadable", unreadable)
    payload, unmeasured = _value_state(
        payload, ("autonomy_ratio", "critique_completion_rate"), _UNMEASURED_REASONS)
    return _family("ok", unmeasured,
                   {**payload, **_judgement(scan, "autonomy", cfg.min_learners, single)})


def _collector_trust(cfg: ObservatoryConfig, root: Path, course: str, scan: _Scan,
                     single: bool) -> dict:
    """The trust summary, without the raw per-scene payload the reader also returns."""
    state, _short, reason = _family_state(scan, "trust", cfg.min_learners, COLLECTOR_LABEL,
                                          "grounded audits", per_scene=True)
    if state != "ok":
        return _family(state, reason)
    read, fault = _read(lambda: metrics.compute_trust_calibration(root, course),
                        "the trust calibration reader")
    if fault is not None:
        return _family(*fault)
    payload, unreadable = _measured(
        read, ("trust_calibration", "n_audits", "over_trust", "over_distrust"), ("band",))
    if payload is None:
        return _family("unreadable", unreadable)
    payload, unmeasured = _value_state(payload, ("trust_calibration",), _UNMEASURED_REASONS,
                                       secondary=("over_distrust",))
    return _family("ok", unmeasured,
                   {**payload, **_judgement(scan, "trust", cfg.min_learners, single)})


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

    report, fault = _read(lambda: build_report(root, min_learners=cfg.min_learners),
                          "the class report")
    if fault is not None:
        return _blank(base, *fault)
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
    # INT-STUDIUM-030, R1 — ONE identity rule, and it is the preflight's. `build_report`
    # falls back to a stream's own FILE PATH when a stream carries no pseudonym
    # (`tools/class_report.py:163`, `learner_ids |= stream_ids or {f"stream:{sf}"}`), so its
    # `n_learners` can count one synthetic learner per pseudonym-less stream: a population
    # counted by a different rule from the one this page floored. The count published here is
    # the population the floor was actually applied to. `build_report`'s own figure is still
    # shown, under the name it honestly has — `n_streams` — and the divergence row therefore
    # compares two populations counted the same way on both sides, or it compares nothing.
    pairs = _people(sum(len(ids) for ids in scan.participants.values()), single)
    base.update(_scope_view(scan, SESSIONS_LABEL))
    base["status"] = "ok"
    base["lessons"] = sorted(scan.participants)
    base["n_lessons"] = len(scan.participants)
    base["n_streams"] = report.get("n_streams")
    base.update(pairs)
    base["report"] = {
        **pairs, "n_streams": report.get("n_streams"),
        "completion": _sessions_completion(cfg, report, scan),
        "autonomy": _sessions_autonomy(cfg, report, scan, single),
        "trust": _sessions_trust(cfg, report, scan, single),
    }
    return base


def _sessions_completion(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan) -> dict:
    state, _short, reason = _family_state(scan, "completion", cfg.min_learners, SESSIONS_LABEL,
                                          "lesson starts and completions")
    if state != "ok":
        return _family(state, reason)
    payload, unreadable = _measured(report, ("completion_rate",))
    if payload is None:
        return _family("unreadable", unreadable)
    payload, unmeasured = _value_state(payload, ("completion_rate",), _UNMEASURED_REASONS)
    return _family("ok", unmeasured, payload)


def _sessions_autonomy(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan,
                       single: bool) -> dict:
    state, _short, reason = _family_state(scan, "autonomy", cfg.min_learners, SESSIONS_LABEL,
                                          "lesson completions carrying an autonomy_ratio")
    if state != "ok":
        return _family(state, reason)
    payload, unreadable = _measured(report, ("mean_autonomy",))
    if payload is None:
        return _family("unreadable", unreadable)
    payload, unmeasured = _value_state(payload, ("mean_autonomy",), _UNMEASURED_REASONS)
    return _family("ok", unmeasured,
                   {**payload, **_judgement(scan, "autonomy", cfg.min_learners, single)})


def _sessions_trust(cfg: ObservatoryConfig, report: Mapping[str, Any], scan: _Scan,
                    single: bool) -> dict:
    """The class report's trust summary, without its `scenes` list."""
    state, _short, reason = _family_state(scan, "trust", cfg.min_learners, SESSIONS_LABEL,
                                          "grounded audits", per_scene=True)
    if state != "ok":
        return _family(state, reason)
    section = report.get("trust_calibration")
    section = section if isinstance(section, Mapping) else {}
    payload, unreadable = _measured(section, ("n_scenes", "gap"), ("band",))
    if payload is None:
        return _family("unreadable", unreadable)
    payload, unmeasured = _value_state(payload, ("gap",), _UNMEASURED_REASONS)
    claimed = section.get("measured")
    if isinstance(claimed, bool) and claimed != payload["measured"]:
        # The class report keeps its own flag; this page does not forward it. A reader that
        # says it measured something beside the `null` it published is exactly the shape R1
        # exists to catch, so the disagreement is stated rather than resolved silently.
        unmeasured = f"{unmeasured + ' ' if unmeasured else ''}the class report's own " \
                     f"`measured` says {claimed} for this section; the flag here is computed " \
                     f"from the value actually published."
    summary = {key: payload[key] for key in ("measured", "n_scenes", "gap", "band")}
    return _family("ok", unmeasured,
                   {**summary, **_judgement(scan, "trust", cfg.min_learners, single)})


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
    "broken": "not shown: a defect in this page, not in the telemetry",
    "suppressed": "withheld by the k-anonymity floor",
    "withheld": "withheld for the reason the family carries",
    "absent": "absent",
    "unreadable": "unreadable",
    "empty": "empty",
}

#: The two states that mean "this family exists and its number is not being shown". They
#: differ in the cause, never in what a reader may infer from them.
_WITHHOLDING = ("suppressed", "withheld")


def _pair_families(collector: dict, sessions: dict) -> None:
    """Suppress a family whose pair on the other source withholds. In place, on two
    columns that are both `ok` — there is nothing to protect against when the other source
    is absent, unreadable or suppressed as a whole.

    Both withholding states count. The pair is suppressed because publishing one side of a
    family the other side will not show narrows what was withheld, and that is true however
    the other side came to withhold it — so the reason says that, rather than naming a floor
    that may not have been the cause.
    """
    if collector.get("status") != "ok" or sessions.get("status") != "ok":
        return
    for collector_key, sessions_key in _PAIRED_FAMILIES:
        left = collector[collector_key]
        right = sessions["report"][sessions_key]
        if left["status"] in _WITHHOLDING and right["status"] not in _WITHHOLDING:
            sessions["report"][sessions_key] = _family(
                "suppressed", f"suppressed with its pair on the {COLLECTOR_LABEL}, which "
                              f"withheld the same family; showing this side alone would "
                              f"narrow what that side withheld")
        elif right["status"] in _WITHHOLDING and left["status"] not in _WITHHOLDING:
            collector[collector_key] = _family(
                "suppressed", f"suppressed with its pair on the {SESSIONS_LABEL}, which "
                              f"withheld the same family; showing this side alone would "
                              f"narrow what that side withheld")


def _trust_pair(collector: dict, sessions: dict) -> tuple[dict, dict] | None:
    """The two trust families when both are publishable numbers, else None."""
    left = collector["trust"]
    right = sessions["report"]["trust"]
    if left["status"] != "ok" or right["status"] != "ok":
        return None
    if left.get("trust_calibration") is None or right.get("measured") is not True:
        return None
    if _finite(left.get("trust_calibration")) is None or _finite(right.get("gap")) is None:
        # `abs(nan - nan) > tolerance` is False, which renders as agreement.
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
            "indicator_names": dict(INDICATOR_NAMES),
            "min_learners": cfg.min_learners, "notes": notes}
