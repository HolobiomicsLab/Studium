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

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from observatory_discovery import CourseRef
from observatory_paths import ensure_importable

ensure_importable()

import astra_render  # noqa: E402  (the MyST page: one renderer, no second formatter)
from harness.scene_judge import VERDICTS, worst  # noqa: E402  (public names; _SEVERITY is not)
from provenance.astra_emit import analysis_body, source_edge_id  # noqa: E402
from provenance.astra_read import (  # noqa: E402
    MISSING,
    REVIEW_DIR,
    REVIEW_FILE,
    VERDICTS_BASENAME,
    ReviewDoc,
    load_course,
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


def analyses_of(doc: Mapping[str, Any] | None) -> list[tuple[str, Mapping[str, Any]]]:
    """(slug, body) pairs. A nested document yields its `analyses`; a pre-nesting flat
    document is its own single body, the rule `astra_emit.analysis_body` applies."""
    if not doc or not isinstance(doc, Mapping):
        return []
    analyses = doc.get("analyses")
    if isinstance(analyses, Mapping) and analyses:
        return [(str(slug), _mapping(body)) for slug, body in analyses.items()]
    if analyses:
        # The document declares a container and wrote something else. It is not a flat
        # legacy document either, so there is no body to show: an empty analyses list,
        # not the `analysis_body` traversal that would raise on it.
        LOGGER.warning("astra.yaml has a non-mapping `analyses` block: %r", type(analyses).__name__)
        return []
    slug, body = analysis_body(dict(doc))
    return [(slug or "root", _mapping(body))]


def _defaults_by_analysis(doc: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    return {slug: {did: _mapping(d).get("default")
                   for did, d in _mapping(body.get("decisions")).items()}
            for slug, body in analyses_of(doc)}


def universe_diff(universe: Mapping[str, Any],
                  doc: Mapping[str, Any] | None) -> dict[str, list[Any]]:
    """`{decision: [default, chosen]}` for every option this universe moves away from
    the default of the analysis it nests under."""
    per_analysis = _defaults_by_analysis(doc)
    merged: dict[str, Any] = {}
    for defaults in per_analysis.values():
        merged.update(defaults)

    diff: dict[str, list[Any]] = {}
    nested = universe.get("analyses")
    pairs: list[tuple[dict[str, Any], Mapping[str, Any]]]
    if isinstance(nested, Mapping) and nested:
        pairs = [(per_analysis.get(str(slug), merged), _mapping(_mapping(body).get("decisions")))
                 for slug, body in nested.items()]
    else:
        pairs = [(merged, _mapping(universe_selection(universe)))]
    for defaults, selection in pairs:
        for did, chosen in selection.items():
            default = defaults.get(did)
            if chosen != default:
                diff[did] = [default, chosen]
    return diff


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
    return {
        "id": slug,
        "source_edge_id": source_edge_id(decision, slug),
        "label": decision.get("label", slug),
        "default": decision.get("default"),
        "rationale": decision.get("rationale", ""),
        "options": [{"id": oid, "label": _mapping(o).get("label", oid),
                     "excluded_reason": _mapping(o).get("excluded_reason")}
                    for oid, o in options.items()],
        "tags": list(decision.get("tags") or []),
    }


def _finding_view(slug: str, finding: Mapping[str, Any]) -> dict[str, Any]:
    evidence = finding.get("evidence") or []
    evidence = evidence if isinstance(evidence, list) else []
    return {
        "id": slug,
        "source_edge_id": source_edge_id(finding, slug),
        "claim": finding.get("claim", ""),
        "notes": finding.get("notes", ""),
        "evidence": [{"id": e.get("id", ""), "artifact": e.get("artifact", ""),
                      "quote_exact": e.get("quote_exact"), "notes": e.get("notes")}
                     for e in evidence if isinstance(e, Mapping)],
    }


def _review_view(review: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """The scene-review verdicts, counted the way `astra_render._review_section` does."""
    if not review or not isinstance(review, Mapping):
        return None
    bodies = analyses_of(review)          # the first analysis, as `_review_section` reads it
    body = bodies[0][1] if bodies else {}
    rows = [{"id": slug, "source_edge_id": source_edge_id(_mapping(d), slug),
             "default": _mapping(d).get("default"), "label": _mapping(d).get("label", slug)}
            for slug, d in _mapping(_mapping(body).get("decisions")).items()]
    return {"n_decisions": len(rows),
            "n_non_pass": len([r for r in rows if r["default"] != "pass"]),
            "rows": rows}


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


def _not_a_list(value: Any) -> str:
    """The marker for a block of the wrong type: the TYPE, never the content.

    Same vocabulary as `astra_read._not_a_mapping`, and for the same reason — this string
    is rendered on an operator page, and a review file is author-editable text.
    """
    return f"unreadable: not a list ({type(value).__name__})"


def _bundle_identity(doc: ReviewDoc, legacy: bool) -> tuple[str, str]:
    """The bundle id to display, and where it was taken from.

    `scene_judge.write_review` slugifies an author-supplied bundle id into a directory name
    that can hold no path separator (`Unit 1/Intro` becomes `Unit-1-Intro`), and
    `load_course` reports that DIRECTORY as `ReviewDoc.bundle_id`. The identity the judge
    recorded is the one inside `verdicts.json`; the slug is only where it was stored. Both
    are shown, and where the document carries no identity the fallback is stated rather
    than passed off as one.
    """
    if legacy:
        return "", "legacy course-level review (written before reviews were keyed by bundle)"
    judged = _mapping(doc.verdicts).get("bundle_id")
    if isinstance(judged, str) and judged.strip() and judged != NO_BUNDLE_ID:
        return judged, "verdicts.json"
    if doc.bundle_id:
        return doc.bundle_id, "directory name (verdicts.json carries no bundle id)"
    return "", "no bundle id on disk"


def _verdict_view(entry: Mapping[str, Any]) -> dict[str, Any]:
    """One (dimension, verdict) row of a judged scene.

    `failure_scenario` and `quote` are the judge's own text about the BUNDLE — a quiz stem,
    a planted flaw — never about a learner and never a telemetry field, and they are the
    thing the operator acts on (spec N1 governs telemetry, which this reader never opens).
    """
    verdict = entry.get("verdict")
    confidence = entry.get("confidence")
    return {"dimension": str(entry.get("dimension", "")),
            "verdict": verdict if isinstance(verdict, str) else "",
            "failure_scenario": str(entry.get("failure_scenario") or ""),
            "quote": str(entry.get("quote") or ""),
            "confidence": confidence if isinstance(confidence, (int, float)) else None}


def _calibration_view(calibration: Any) -> dict[str, Any] | None:
    """The corrupted-scene separation check, reduced to the three fields an operator acts
    on. `gold` and `pred` are the raw per-pair booleans: they say nothing that is acted on
    and they lengthen the page, so they are deliberately not copied."""
    block = _mapping(calibration)
    if not block:
        return None
    kappa, pairs = block.get("kappa"), block.get("pairs")
    return {
        "kappa": float(kappa) if isinstance(kappa, (int, float)) and not isinstance(kappa, bool)
                 else None,
        "separates": bool(block.get("separates")),
        "pairs": pairs if isinstance(pairs, int) and not isinstance(pairs, bool) else 0,
    }


def _verdicts_view(verdicts: Mapping[str, Any]) -> dict[str, Any]:
    """The judged half of one bundle, scenes worst case first.

    Every block is read with a type guard. A review file is author-editable, so a wrong
    shape has to yield an empty block or a named marker rather than an exception — and an
    unrecognised verdict must not reach `worst()`, whose severity map would raise on it.
    """
    scenes: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    ranked: list[str] = []
    for scene_id, entries in _mapping(verdicts.get("scenes")).items():
        if not isinstance(entries, list):
            skipped.append({"scene_id": str(scene_id), "reason": _not_a_list(entries)})
            continue
        rows = [_verdict_view(_mapping(entry)) for entry in entries if isinstance(entry, Mapping)]
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
                for scene_id, reason in _mapping(verdicts.get("skipped")).items()]
    skipped.sort(key=lambda entry: entry["scene_id"])

    worst_case = _mapping(verdicts.get("worst_case"))
    return {
        "worst_overall": worst(ranked) if ranked else None,
        "worst_case": {str(d): str(v) for d, v in worst_case.items()} if worst_case else None,
        "n_scenes": len(scenes),
        "n_defects": len([row for scene in scenes for row in scene["verdicts"]
                          if row["verdict"] == "defect"]),
        "n_skipped": len(skipped),
        "scenes": scenes,
        "skipped": skipped,
        "calibration": _calibration_view(verdicts.get("calibration")),
    }


def _bundle_view(doc: ReviewDoc, absent: Mapping[str, str]) -> dict[str, Any]:
    """One review on screen: its identity, its ASTRA rows, and its verdicts when readable.

    The two halves are independent, as `load_course` reads them: an unreadable
    `verdicts.json` leaves the ASTRA rows standing and shows a marker in their place
    (spec N3).
    """
    legacy = doc.rel == REVIEW_FILE
    verdicts_rel = (f"{REVIEW_DIR}/{VERDICTS_BASENAME}" if legacy
                    else f"{REVIEW_DIR}/{doc.bundle_id}/{VERDICTS_BASENAME}")
    bundle_id, bundle_id_source = _bundle_identity(doc, legacy)
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
    }
    if doc.verdicts is None:
        # `load_course` already named why under this path; the legacy layout never had the
        # file at all, and `MISSING` is exactly what it is.
        view["verdicts_absent"] = absent.get(verdicts_rel, MISSING)
        return view
    try:
        view.update(_verdicts_view(doc.verdicts))
    except Exception as exc:  # noqa: BLE001 - a hand-edited review must not take the page down
        LOGGER.warning("unreadable verdicts %s: %s: %s", verdicts_rel, type(exc).__name__, exc)
        view["verdicts_absent"] = f"unreadable: {type(exc).__name__}"
    return view


def reviews_detail(ref: CourseRef) -> dict[str, Any]:
    """Every scene review of one course, worst case first at both levels.

    The ordering is the judge's own: `VERDICTS` and `worst()` are imported rather than
    copied (spec R9), so "worst case first" here means what it means inside the review.
    A bundle whose verdicts are absent or unreadable sorts as `pass` and says why in
    `verdicts_absent`; `worst_overall is None` is what separates "not read" from
    "reviewed and clean".
    """
    docs = load_course(ref.path, strict=False)
    bundles = [_bundle_view(doc, docs.absent) for doc in docs.reviews]
    bundles.sort(key=lambda b: (-_severity(b["worst_overall"]), b["bundle_id"], b["dir_slug"]))
    return {"course_id": ref.id, "bundles": bundles, "absent": dict(docs.absent)}


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

    nodes = _mapping(docs.trace).get("nodes") or []
    nodes = nodes if isinstance(nodes, list) else []
    return {
        "summary": asdict(summary),
        "analyses": analyses,
        "universes": universes,
        "trace_schema_version": _mapping(docs.trace).get("schema_version"),
        "trace_mermaid": "\n".join(astra_render._trace_mermaid(nodes)) if docs.trace else None,
        "trace_bullets": "\n".join(astra_render._trace_bullets(nodes)) if docs.trace else None,
        "review": _review_view(docs.review),
        "absent": dict(docs.absent),
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