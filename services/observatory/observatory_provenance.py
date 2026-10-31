"""Read a course's ASTRA set into view data.

Every fact on the provenance pages comes from the artifacts the planner already writes,
through the loader the MyST renderer uses (`provenance.astra_read.load_course`) and the
emitter's own accessors (`analysis_body`, `source_edge_id`). Nothing is recomputed here
and no reader is copied: this module only reshapes what those return into the flat,
JSON-serialisable dictionaries the templates and the API twins render (spec constraint
R9).

Reading is non-strict: a missing or unreadable file becomes an entry in `absent` that
the page shows as a marker, never an error page (spec constraint N3).

The exploration trace is formatted by `astra_render._trace_mermaid` and `_trace_bullets`.
They are private names of that module, used here deliberately rather than copied;
promoting them to public names is a change to a file the product owner owns and is out
of this slice.
"""
from __future__ import annotations

import logging
import math

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from observatory_discovery import CourseRef
from observatory_paths import ensure_importable

ensure_importable()

import astra_render  # noqa: E402  (the MyST page: one renderer, no second formatter)
from harness.scene_judge import (  # noqa: E402  (public names; _SEVERITY is not)
    VERDICTS,
    bundle_slug,
    worst,
)
from provenance.astra_emit import analysis_body, source_edge_id  # noqa: E402
from provenance.astra_read import (  # noqa: E402
    MISSING,
    REVIEW_DIR,
    REVIEW_FILE,
    VERDICTS_BASENAME,
    ReviewDoc,
    analyses_of,
    evidence_view,
    load_course,
    universe_diff,
    universe_selection,
)


LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class CourseSummary:
    """One row of the courses table."""

    id: str
    path: str
    name: str | None
    version: str | None
    n_analyses: int
    n_decisions: int
    n_findings: int
    universes: tuple[str, ...]
    has_trace: bool
    has_review: bool
    absent: dict[str, str]


def _mapping(value: Any) -> Mapping[str, Any]:
    """`value` when it is a mapping, an empty one otherwise.

    Applied at every container this module walks. No emitter writes a list where the
    schema says mapping, but a hand-edited or half-written file does, and the index
    summarises every course: one such file must not take the whole surface down
    (spec constraint N3). The gap shows as an empty block, and `load_course` already
    names a whole document of the wrong shape in `absent`.
    """
    return value if isinstance(value, Mapping) else {}


def summarize_course(ref: CourseRef) -> CourseSummary:
    docs = load_course(ref.path, strict=False)
    bodies = [body for _, body in analyses_of(docs.astra)]
    return CourseSummary(
        id=ref.id,
        path=str(ref.path),
        name=_mapping(docs.astra).get("name"),
        version=_mapping(docs.astra).get("version"),
        n_analyses=len(bodies),
        n_decisions=sum(len(_mapping(b.get("decisions"))) for b in bodies),
        n_findings=sum(len(_mapping(b.get("findings"))) for b in bodies),
        universes=tuple(str(u.get("id", "")) for u in docs.universes),
        has_trace=docs.trace is not None,
        has_review=docs.review is not None,
        absent=dict(docs.absent),
    )


def _port_ids(items: Any) -> list[str]:
    """Input and output ports as ids; the full port objects belong in the artifact."""
    if not isinstance(items, list):
        return []
    return [str(i.get("id", "")) if isinstance(i, Mapping) else str(i) for i in items]


def _decision_view(slug: str, decision: Mapping[str, Any]) -> dict[str, Any]:
    options = _mapping(decision.get("options"))
    tags = decision.get("tags")
    valid_tags = isinstance(tags, list) and all(isinstance(tag, str) for tag in tags)
    return {
        "id": slug,
        "source_edge_id": source_edge_id(decision, slug),
        "label": decision.get("label", slug),
        "default": decision.get("default"),
        "rationale": decision.get("rationale", ""),
        "options": [{"id": oid, "label": _mapping(o).get("label", oid),
                     "excluded_reason": _mapping(o).get("excluded_reason")}
                    for oid, o in options.items()],
        "tags": tags if valid_tags else [],
        "tags_unreadable": tags is not None and not valid_tags,
    }


def _finding_view(slug: str, finding: Mapping[str, Any]) -> dict[str, Any]:
    evidence = finding.get("evidence") or []
    evidence = evidence if isinstance(evidence, list) else []
    return {
        "id": slug,
        "source_edge_id": source_edge_id(finding, slug),
        "claim": finding.get("claim", ""),
        "notes": finding.get("notes", ""),
        "evidence": [evidence_view(e) for e in evidence if isinstance(e, Mapping)],
    }


def _review_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Count the rendered ASTRA verdict rows without recomputing judge outcomes."""
    return {"n_decisions": len(rows),
            "n_non_pass": len([r for r in rows if r["default"] != "pass"]),
            "rows": rows}


def _review_view(review: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Every analysis in one scene-review document, with its analysis identity."""
    if not review or not isinstance(review, Mapping):
        return None
    rows = [{"id": slug, "analysis_id": analysis_id,
             "source_edge_id": source_edge_id(_mapping(d), slug),
             "default": _mapping(d).get("default"), "label": _mapping(d).get("label", slug),
             "rationale": _mapping(d).get("rationale", "")}
            for analysis_id, body in analyses_of(review)
            for slug, d in _mapping(body.get("decisions")).items()]
    findings = [{**_finding_view(str(slug), _mapping(f)), "analysis_id": analysis_id}
                for analysis_id, body in analyses_of(review)
                for slug, f in _mapping(body.get("findings")).items()]
    return {**_review_summary(rows), "findings": findings}


def _course_review_view(reviews: tuple[ReviewDoc, ...]) -> dict[str, Any] | None:
    """Aggregate readable review documents while retaining each row's origin."""
    rows = []
    findings = []
    readable = False
    for doc in reviews:
        view = _review_view(doc.astra)
        if view is None:
            continue
        readable = True
        bundle_id, _ = _bundle_identity(doc, doc.rel == REVIEW_FILE, [])
        rows.extend({**row, "bundle_id": bundle_id, "rel": doc.rel}
                    for row in view["rows"])
        findings.extend({**finding, "bundle_id": bundle_id, "rel": doc.rel}
                        for finding in view["findings"])
    return {**_review_summary(rows), "findings": findings} if readable else None


#: What `judge_bundle` records for a bundle whose `lesson.json` carries no id, and what
#: `bundle_slug` stores as the directory `unknown-bundle`. It is the judge's marker for an
#: absent identity, so it is not displayed as one.
NO_BUNDLE_ID = "?"


def _severity(verdict: str | None) -> int:
    """Rank of a verdict on the judge's own scale.

    An absent or unrecognised verdict ranks as `pass`, so a bundle whose verdicts could not
    be read sorts last instead of raising a permanent alarm. What says it was not read is
    `worst_overall is None`, never the string `"pass"`.
    """
    return VERDICTS.index(verdict) if verdict in VERDICTS else 0


def _wrong_type(expected: str, value: Any) -> str:
    """The marker for a block or field of the wrong type: the TYPE, never the content.

    Same vocabulary as `astra_read._not_a_mapping`, and for the same reason — this string
    is rendered on an operator page, and a review file is author-editable text.
    """
    return f"unreadable: not {expected} ({type(value).__name__})"


def _not_a_list(value: Any) -> str:
    """A scene whose verdicts are not a list of verdicts."""
    return _wrong_type("a list", value)


#: A word in a verdict field that is not one of the judge's three. It cannot be ranked
#: (`worst()` has no severity for it) and it must not be displayed as a verdict either:
#: an operator reads whatever sits in that column as one.
UNKNOWN_VERDICT = "unreadable: not one of the judge's verdicts"
#: The judged id does not slugify to the directory it was found in. One of the two is
#: wrong and this reader cannot tell which, so it names the conflict instead of resolving
#: it — the claim is never disclosed, only that it disagrees with the location.
IDENTITY_CONFLICT = "unreadable: names a bundle other than the directory storing it"
#: Cohen's kappa is a correlation coefficient and `confidence` is a probability. A value
#: outside its range, or a non-finite one, records no measurement — and a non-finite float
#: cannot be serialised by `JSONResponse` at all (`allow_nan=False`), so passing one
#: through turns a malformed review into a 500 on the API twin instead of a marker (N3).
KAPPA_RANGE = (-1.0, 1.0)
CONFIDENCE_RANGE = (0.0, 1.0)


def _number(value: Any, low: float, high: float) -> float | None:
    """`value` as a finite float inside [low, high], or None when it is not one.

    `bool` is excluded deliberately: `True` is an `int` in Python, so an unguarded numeric
    check reads a `true` in a numeric field as the measurement `1.0`.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or not low <= number <= high:
        return None
    return number


def _number_problem(value: Any, low: float, high: float) -> str:
    """Why a numeric field could not be used: its TYPE, or the range it left."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return _wrong_type("a number", value)
    return f"unreadable: not a finite number in [{low:g}, {high:g}]"


def _bundle_identity(doc: ReviewDoc, legacy: bool,
                     problems: list[dict[str, str]]) -> tuple[str, str]:
    """The bundle id to display, and where it was taken from.

    `scene_judge.write_review` slugifies an author-supplied bundle id into a directory name
    that can hold no path separator (`Unit 1/Intro` becomes `Unit-1-Intro`), and
    `load_course` reports that DIRECTORY as `ReviewDoc.bundle_id`. The identity the judge
    recorded is the one inside `verdicts.json`; the slug is only where it was stored. Both
    are shown, and where the document carries no identity the fallback is stated rather
    than passed off as one.

    A judged id that does not slugify back to its own directory is neither: the file has
    been moved, or edited, and the directory — the one fact this reader observed rather
    than read — is shown while the disagreement is named.
    """
    if legacy:
        return "", "legacy course-level review (written before reviews were keyed by bundle)"
    judged = _mapping(doc.verdicts).get("bundle_id")
    if isinstance(judged, str) and judged.strip() and judged != NO_BUNDLE_ID:
        if not doc.bundle_id or bundle_slug(judged) == doc.bundle_id:
            return judged, "verdicts.json"
        problems.append({"field": "bundle_id", "reason": IDENTITY_CONFLICT})
        return doc.bundle_id, "directory name (verdicts.json names a different bundle)"
    if doc.bundle_id:
        return doc.bundle_id, "directory name (verdicts.json carries no bundle id)"
    return "", "no bundle id on disk"


def _verdict_view(entry: Mapping[str, Any], field: str,
                  problems: list[dict[str, str]]) -> dict[str, Any]:
    """One (dimension, verdict) row of a judged scene.

    `failure_scenario` and `quote` are the judge's own text about the BUNDLE — a quiz stem,
    a planted flaw — never about a learner and never a telemetry field, and they are the
    thing the operator acts on (spec N1 governs telemetry, which this reader never opens).
    The two machine-read fields are validated instead: a verdict this judge cannot have
    written, and a confidence that is not a probability, are named and dropped.
    """
    verdict = entry.get("verdict")
    if verdict is not None and verdict not in VERDICTS:
        problems.append({"field": f"{field}.verdict", "reason": UNKNOWN_VERDICT})
        verdict = None
    confidence = entry.get("confidence")
    measured = _number(confidence, *CONFIDENCE_RANGE)
    if measured is None and confidence is not None:
        problems.append({"field": f"{field}.confidence",
                         "reason": _number_problem(confidence, *CONFIDENCE_RANGE)})
    return {"dimension": str(entry.get("dimension", "")),
            "verdict": verdict or "",
            "failure_scenario": str(entry.get("failure_scenario") or ""),
            "quote": str(entry.get("quote") or ""),
            "confidence": measured}


def _calibration_view(calibration: Any,
                      problems: list[dict[str, str]]) -> dict[str, Any] | None:
    """The corrupted-scene separation check, reduced to the three fields an operator acts
    on. `gold` and `pred` are the raw per-pair booleans: they say nothing that is acted on
    and they lengthen the page, so they are deliberately not copied.

    Each of the three is validated rather than coerced. `bool("false")` is `True`, which
    turns a failed calibration into a passing one; `float("nan")` is a float; and a pair
    count defaulting to `0` states a count the file does not hold. An unusable field reads
    as "not recorded", which is what it is, and is named in `problems`.
    """
    if calibration is None:
        return None
    if not isinstance(calibration, Mapping):
        problems.append({"field": "calibration", "reason": _wrong_type("a mapping", calibration)})
        return None
    if not calibration:
        return None

    kappa = calibration.get("kappa")
    measured = _number(kappa, *KAPPA_RANGE)
    if measured is None and kappa is not None:
        problems.append({"field": "calibration.kappa",
                         "reason": _number_problem(kappa, *KAPPA_RANGE)})

    separates = calibration.get("separates")
    if separates is not None and not isinstance(separates, bool):
        problems.append({"field": "calibration.separates",
                         "reason": _wrong_type("a boolean", separates)})
        separates = None

    pairs = calibration.get("pairs")
    if pairs is not None and (isinstance(pairs, bool) or not isinstance(pairs, int)
                              or pairs < 0):
        problems.append({"field": "calibration.pairs",
                         "reason": _wrong_type("a count", pairs)})
        pairs = None
    return {"kappa": measured, "separates": separates, "pairs": pairs}


def _block(verdicts: Mapping[str, Any], name: str,
           problems: list[dict[str, str]]) -> Mapping[str, Any]:
    """One top-level mapping of `verdicts.json`, or an empty one with the fault named.

    Emptying a block of the wrong type without saying so is the shape of fail-soft that
    reads as "nothing to report": every one of these blocks is a place a defect would be
    listed, so an unreadable one has to look different from an empty one (spec N3).
    """
    block = verdicts.get(name)
    if block is None or isinstance(block, Mapping):
        return _mapping(block)
    problems.append({"field": name, "reason": _wrong_type("a mapping", block)})
    return {}


def _verdicts_view(verdicts: Mapping[str, Any],
                   problems: list[dict[str, str]]) -> dict[str, Any]:
    """The judged half of one bundle, scenes worst case first.

    Every block is read with a type guard. A review file is author-editable, so a wrong
    shape has to yield an empty block or a named marker rather than an exception — and an
    unrecognised verdict must not reach `worst()`, whose severity map would raise on it.
    """
    scenes: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    ranked: list[str] = []
    for scene_id, entries in _block(verdicts, "scenes", problems).items():
        if not isinstance(entries, list):
            skipped.append({"scene_id": str(scene_id), "reason": _not_a_list(entries)})
            continue
        rows = [_verdict_view(_mapping(entry), f"scenes.{scene_id}[{index}]", problems)
                for index, entry in enumerate(entries) if isinstance(entry, Mapping)]
        scene_ranked = [row["verdict"] for row in rows if row["verdict"] in VERDICTS]
        ranked += scene_ranked
        scenes.append({"scene_id": str(scene_id),
                       "worst": worst(scene_ranked) if scene_ranked else None,
                       "verdicts": rows})
    scenes.sort(key=lambda scene: (-_severity(scene["worst"]), scene["scene_id"]))

    # The judge's own skipped scenes carry its reason for not judging them; the reader's
    # markers above carry why a block could not be read. Both answer "why is this scene
    # not judged?", so they share one list.
    skipped += [{"scene_id": str(scene_id), "reason": str(reason)}
                for scene_id, reason in _block(verdicts, "skipped", problems).items()]
    skipped.sort(key=lambda entry: entry["scene_id"])

    worst_case: dict[str, str] = {}
    for dimension, verdict in _block(verdicts, "worst_case", problems).items():
        if verdict in VERDICTS:
            worst_case[str(dimension)] = str(verdict)
        else:
            problems.append({"field": "worst_case", "reason": UNKNOWN_VERDICT})
    return {
        "worst_overall": worst(ranked) if ranked else None,
        "worst_case": worst_case or None,
        "n_scenes": len(scenes),
        "n_defects": len([row for scene in scenes for row in scene["verdicts"]
                          if row["verdict"] == "defect"]),
        "n_skipped": len(skipped),
        "scenes": scenes,
        "skipped": skipped,
        "calibration": _calibration_view(verdicts.get("calibration"), problems),
    }


def _distinct(problems: list[dict[str, str]]) -> list[dict[str, str]]:
    """The same faults, each named once, in the order they were found.

    A document repeats a shape: five `worst_case` entries carrying the same unknown word
    are one fault to act on, not five markers to read.
    """
    seen: set[tuple[str, str]] = set()
    unique: list[dict[str, str]] = []
    for problem in problems:
        key = (problem["field"], problem["reason"])
        if key not in seen:
            seen.add(key)
            unique.append(problem)
    return unique


def _bundle_view(doc: ReviewDoc, absent: Mapping[str, str]) -> dict[str, Any]:
    """One review on screen: its identity, its ASTRA rows, and its verdicts when readable.

    The two halves are independent, as `load_course` reads them: an unreadable
    `verdicts.json` leaves the ASTRA rows standing and shows a marker in their place
    (spec N3).
    """
    legacy = doc.rel == REVIEW_FILE
    verdicts_rel = (f"{REVIEW_DIR}/{VERDICTS_BASENAME}" if legacy
                    else f"{REVIEW_DIR}/{doc.bundle_id}/{VERDICTS_BASENAME}")
    #: Fields of THIS review that were present and unusable, as `{field, reason}`. A
    #: whole file that could not be read is `verdicts_absent`; this is the half-way
    #: state the page had no way of showing, where the file parsed and one value in it
    #: is not a value of the kind it claims to be.
    problems: list[dict[str, str]] = []
    bundle_id, bundle_id_source = _bundle_identity(doc, legacy, problems)
    view: dict[str, Any] = {
        "bundle_id": bundle_id,
        "bundle_id_source": bundle_id_source,
        "dir_slug": doc.bundle_id,
        "legacy": legacy,
        "rel": doc.rel,
        "verdicts_rel": verdicts_rel,
        "astra_rows": _review_view(doc.astra),
        "worst_overall": None,
        "worst_case": None,
        "n_scenes": 0,
        "n_defects": 0,
        "n_skipped": 0,
        "scenes": [],
        "skipped": [],
        "calibration": None,
        "verdicts_absent": None,
        "problems": problems,
    }
    if doc.verdicts is None:
        # `load_course` already named why under this path; the legacy layout never had the
        # file at all, and `MISSING` is exactly what it is.
        view["verdicts_absent"] = absent.get(verdicts_rel, MISSING)
        return view
    try:
        view.update(_verdicts_view(doc.verdicts, problems))
    except Exception as exc:  # noqa: BLE001 - a hand-edited review must not take the page down
        LOGGER.warning("unreadable verdicts %s: %s: %s", verdicts_rel, type(exc).__name__, exc)
        view["verdicts_absent"] = f"unreadable: {type(exc).__name__}"
    view["problems"] = _distinct(problems)
    return view


def reviews_detail(ref: CourseRef) -> dict[str, Any]:
    """Every scene review of one course, worst case first at both levels.

    The ordering is the judge's own: `VERDICTS` and `worst()` are imported rather than
    copied (spec R9), so "worst case first" here means what it means inside the review.
    A bundle whose verdicts are absent or unreadable sorts as `pass` and says why in
    `verdicts_absent`; `worst_overall is None` is what separates "not read" from
    "reviewed and clean". A file that parsed but holds a value of the wrong kind is
    neither: those fields read as "not recorded" and are named one by one in the
    bundle's `problems`, so a single bad number never reads as a clean review.
    """
    docs = load_course(ref.path, strict=False)
    bundles = [_bundle_view(doc, docs.absent) for doc in docs.reviews]
    bundles.sort(key=lambda b: (-_severity(b["worst_overall"]), b["bundle_id"], b["dir_slug"]))
    return {"course_id": ref.id, "bundles": bundles, "absent": dict(docs.absent)}


def _trace_view(trace: Mapping[str, Any] | None) -> tuple[str | None, str | None, str | None]:
    """Format the shared trace as a block; malformed nodes leave other sections readable."""
    if not trace:
        return None, None, None
    try:
        nodes = trace.get("nodes") or []
        if not isinstance(nodes, list):
            raise TypeError("trace nodes must be a list")
        return ("\n".join(astra_render._trace_mermaid(nodes)),
                "\n".join(astra_render._trace_bullets(nodes)), None)
    except (TypeError, KeyError, AttributeError, ValueError, RecursionError) as exc:
        LOGGER.warning("Trace formatting failed: %s", type(exc).__name__)
        return None, None, f"unreadable: {type(exc).__name__}"


def course_detail(ref: CourseRef) -> dict[str, Any]:
    """Everything the course page shows, JSON-serialisable."""
    docs = load_course(ref.path, strict=False)
    summary = summarize_course(ref)

    analyses = []
    for slug, body in analyses_of(docs.astra):
        analyses.append({
            "slug": slug,
            "name": body.get("name", slug),
            "description": body.get("description", ""),
            "inputs": _port_ids(body.get("inputs")),
            "outputs": _port_ids(body.get("outputs")),
            "decisions": [_decision_view(str(s), _mapping(d))
                          for s, d in _mapping(body.get("decisions")).items()],
            "findings": [_finding_view(str(s), _mapping(f))
                         for s, f in _mapping(body.get("findings")).items()],
        })

    universes = [{"id": str(u.get("id", "")), "description": u.get("description", ""),
                  "selection": _mapping(universe_selection(u)),
                  "diff_from_default": universe_diff(u, docs.astra)}
                 for u in docs.universes]

    trace_mermaid, trace_bullets, trace_problem = _trace_view(docs.trace)
    absent = dict(docs.absent)
    if trace_problem:
        absent["trace/exploration_tree.yaml"] = trace_problem
    return {
        "summary": asdict(summary),
        "analyses": analyses,
        "universes": universes,
        "trace_schema_version": _mapping(docs.trace).get("schema_version"),
        "trace_mermaid": trace_mermaid,
        "trace_bullets": trace_bullets,
        "review": _review_view(docs.review),
        "review_summary": _course_review_view(docs.reviews),
        "absent": absent,
    }


def myst_page(ref: CourseRef) -> str:
    """The MyST page `astra_render.render` writes, verbatim.

    The renderer loads strictly, so one unparsable file under the course raises. The
    Observatory answers with a marker page naming what broke instead (spec N3): a
    course whose universe file is malformed still has a readable provenance page."""
    try:
        return astra_render.render(ref.path)
    except Exception as exc:  # noqa: BLE001 - any reader error becomes a marker page
        LOGGER.warning("MyST page unavailable for %s: %s: %s", ref.path, type(exc).__name__, exc)
        lines = [f"# {ref.id}", "", f"(unreadable course: {type(exc).__name__})"]
        absent = summarize_course(ref).absent
        if absent:
            lines += [""] + [f"- {_marker(name, reason)}" for name, reason in absent.items()]
        return "\n".join(lines) + "\n"


def _marker(name: str, reason: str) -> str:
    """The one marker wording, shared with the templates."""
    if reason == "missing":
        return f"(missing {name})"
    return f"(unreadable {name}: {reason.removeprefix('unreadable: ')})"