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
from provenance.astra_emit import analysis_body, source_edge_id  # noqa: E402
from provenance.astra_read import load_course, universe_selection  # noqa: E402


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
        lines = [f"# {ref.id}", "", f"(unreadable course: {type(exc).__name__}: {exc})"]
        absent = summarize_course(ref).absent
        if absent:
            lines += [""] + [f"- {_marker(name, reason)}" for name, reason in absent.items()]
        return "\n".join(lines) + "\n"


def _marker(name: str, reason: str) -> str:
    """The one marker wording, shared with the templates."""
    if reason == "missing":
        return f"(missing {name})"
    return f"(unreadable {name}: {reason.removeprefix('unreadable: ')})"