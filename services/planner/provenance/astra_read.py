"""astra_read.py — read one course's provenance artifacts from a planner output dir.

Two readers share this loader: `tools/astra_render.py` (the MySTRA page) and the Studium
Observatory (`services/observatory`). The directory layout the planner writes is
therefore described in exactly one place — INT-STUDIUM-008, constraint R9 "reuse, no
third copy".

Layout, as `provenance.astra_emit.write_astra_set` writes it:

  astra.yaml                    ASTRA document (ASB `analyses:` shape; flat legacy accepted)
  universes/*.yaml              option selections (nested shape; flat legacy accepted)
  trace/exploration_tree.yaml   ARA exploration trace (schema 0.1.0)
  review/<bundle_id>/           scene review of ONE bundle (optional, eval/harness/scene_judge.py)
    astra.yaml                    verdicts as ASTRA decisions
    verdicts.json                 the review as the judge computed it
  review/astra.yaml             legacy: one review per course, still read (INT-STUDIUM-020)

A review is keyed by bundle — its analysis id is `f"{bundle_id}-scene-review"` — while a
course holds several bundles, so `review/astra.yaml` could only ever hold the last bundle
judged. Courses reviewed before that was fixed have one, and a reader that stops reading
it would turn an existing artifact into a silent gap; both layouts are therefore read,
and `CourseDocs.review` still names a single document so the renderer is unchanged.

`strict=True` (the default) reproduces the renderer's behaviour: a missing `astra.yaml`
raises `FileNotFoundError`, a YAML or OS error propagates. `strict=False` never raises:
the field stays `None`, an unreadable universe is skipped, and every gap is named in
`absent` under its path relative to the course directory. A document that parses to
something other than a mapping (a list, a bare string) counts as unreadable there: no
emitter writes one, and a reader that cannot crash must still name it.

`review/` is the one part of a course whose names and contents are chosen by whoever
ran the judge, so two rules apply there and nowhere else in this loader. Its two files
are read INDEPENDENTLY — a review whose ASTRA document is missing or malformed still
has verdicts, and dropping the bundle for the first fault would turn a readable
artifact into a silent gap, the fault INT-STUDIUM-020 fixed for the flat legacy file.
And every path under it is checked for CONTAINMENT before it is inspected: `is_file()`
and `is_dir()` follow symlinks, so without that a link dropped into `review/` makes
this loader return, and its readers render, a document from anywhere on the host. An
escaping path is named `OUTSIDE` in `absent` and not opened, under both strictnesses:
containment is a gap in the artifact, not a fault of it, and an operator who assembles
a course with a link into a shared review store gets a named gap rather than a crash
(INT-STUDIUM-028).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from provenance.astra_emit import analysis_body   # the flat-document rule, one definition

ASTRA_FILE = "astra.yaml"
UNIVERSES_DIR = "universes"
TRACE_FILE = "trace/exploration_tree.yaml"
REVIEW_DIR = "review"
REVIEW_BASENAME = "astra.yaml"
VERDICTS_BASENAME = "verdicts.json"
#: Legacy: the one review a course could hold before reviews were keyed by bundle. Still
#: read, and still the name reported when a course has no review at all.
REVIEW_FILE = f"{REVIEW_DIR}/{REVIEW_BASENAME}"

MISSING = "missing"
#: A review artifact whose path leaves the course directory once every link is followed.
#: Named like any other gap and never read: the operator configured one course root, and
#: what a link points at is not part of it. The target is never disclosed.
OUTSIDE = "unreadable: leaves the course directory"

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReviewDoc:
    """One scene review: the ASTRA document, the verdicts the judge computed, and the
    bundle it belongs to (`""` for the legacy course-level document).

    `verdicts` is `None` when the file is absent or unreadable; that never takes the
    ASTRA document down with it, because the two are read independently.
    """

    bundle_id: str
    rel: str
    astra: dict[str, Any] | None = None
    verdicts: dict[str, Any] | None = None


@dataclass(frozen=True)
class CourseDocs:
    """Every provenance document of one course directory, read once.

    `universes` are sorted by file name and carry the file stem as `id` when the
    document has none (the fallback the renderer applied at display time).
    `absent` maps a relative path to `"missing"` or `"unreadable: <ExcType>"`; the
    exception message is logged, never rendered (see `_unreadable`).
    """

    course_dir: Path
    astra: dict[str, Any] | None = None
    universes: tuple[dict[str, Any], ...] = ()
    trace: dict[str, Any] | None = None
    #: The course's review as a single document, for readers that show one: the legacy
    #: file when the course has one, else the first bundle's. `reviews` has them all.
    review: dict[str, Any] | None = None
    reviews: tuple[ReviewDoc, ...] = ()
    absent: dict[str, str] = field(default_factory=dict)


def review_dir(course_dir: Path | str, bundle_id: str) -> Path:
    """`<course>/review/<bundle_id>`: where the review of one bundle is written and read.

    One resolver, used by the writer (`eval/harness/scene_judge.py`) and by the readers,
    so the layout keeps being described in exactly one place (R9).
    """
    return Path(course_dir) / REVIEW_DIR / bundle_id


def load_yaml(path: Path) -> dict[str, Any] | None:
    """The document at `path`, or None when it is not a file."""
    import yaml
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _mapping(value: Any) -> Mapping[str, Any]:
    """`value` when it is a mapping, an empty one otherwise.

    No emitter writes a list where the schema says mapping, but a hand-edited or
    half-written file does, and every caller here summarises a whole course: one such
    file must not take the surface down.
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
    the default of the analysis it nests under.

    Lives here rather than in any one renderer: three surfaces ask the same question of a
    universe — the MyST page, the course audit report and the Observatory — and R9 allows
    one definition, not three that drift.
    """
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


def universe_summary(universe: Mapping[str, Any],
                     doc: Mapping[str, Any] | None) -> dict[str, Any]:
    """What a universe CHANGES, and how many decisions it leaves alone.

    A universe is a delta from the defaults, and a section that prints every decision
    hides the delta inside it: the emitter assigns EVERY decision of the analysis so no
    selection reads `[MISSING_DECISION]`, so the complete list is mostly the default list
    repeated once per universe. Printing the changes and counting the rest states the same
    fact in the form the reader came for (INT-STUDIUM-010 nit 3).

    `at_default` counts the decisions this universe selected and did not move — not the
    decisions of the analysis. A universe that names a decision the document does not
    declare is a change (its default is unknown, hence `None`), and one the document
    declares but the universe never names is neither: it is not part of this selection.
    """
    changed = universe_diff(universe, doc)
    selected = universe_selection(universe)
    return {"changed": changed, "at_default": max(len(selected) - len(changed), 0)}


def summary_lines(summary: Mapping[str, Any], *, indent: str = "  ") -> list[str]:
    """The Markdown bullets both page renderers emit for one universe's selection.

    Takes the summary rather than the universe, so a caller that computed it while it still
    held the ASTRA document — the course audit report does, its renderer runs later from the
    report alone — formats it the same way as one that has both to hand.
    """
    changed = _mapping(summary.get("changed"))
    lines = [f"{indent}- {did}: `{pair[1]}` "
             # A decision the document does not declare, or declares with no default, has
             # nothing to have moved FROM. Rendering that as ``default `None``` would put a
             # default on the page that no artifact records — the shape a course whose
             # universes were written against a different analysis really has.
             + (f"(default `{pair[0]}`)" if pair[0] is not None else "(no default recorded)")
             for did, pair in changed.items() if isinstance(pair, (list, tuple)) and len(pair) == 2]
    at_default = summary.get("at_default") or 0
    if at_default:
        lines.append(f"{indent}- {at_default} decision{'' if at_default == 1 else 's'} at default")
    elif not lines:
        lines.append(f"{indent}- no selection")
    return lines


def universe_summary_lines(universe: Mapping[str, Any],
                           doc: Mapping[str, Any] | None,
                           *, indent: str = "  ") -> list[str]:
    """`summary_lines` for a caller holding the universe and the document."""
    return summary_lines(universe_summary(universe, doc), indent=indent)


def universe_selection(universe: Mapping[str, Any]) -> dict[str, Any]:
    """Option selection of a universe in either shape (nested merged, or flat).

    A block of the wrong shape contributes nothing instead of raising: both callers
    (the renderer and the Observatory) then show an empty selection for a universe no
    emitter wrote, and neither has to guard the formula a second time (R9).
    """
    analyses = universe.get("analyses")
    if not isinstance(analyses, Mapping) or not analyses:
        decisions = universe.get("decisions")
        return dict(decisions) if isinstance(decisions, Mapping) else {}
    merged: dict[str, Any] = {}
    for body in analyses.values():
        decisions = body.get("decisions") if isinstance(body, Mapping) else None
        if isinstance(decisions, Mapping):
            merged.update(decisions)
    return merged


def _unreadable(exc: BaseException) -> str:
    """The reason for a reader fault: the exception TYPE, never its message.

    This string is rendered on an operator page and returned by the JSON twins, and
    it is the one text there that the reader does not author. An OSError names the
    absolute path it failed on; a PyYAML mark block quotes the offending SOURCE LINE
    of the document. The detail goes to the log instead, which is the half of spec
    N3 ("logged with the path") this site never did.

    Reached only on the non-strict path: a strict load still raises with everything.
    """
    LOGGER.warning("unreadable provenance artifact: %s: %s", type(exc).__name__, exc)
    return f"unreadable: {type(exc).__name__}"


def _not_a_mapping(doc: Any) -> str:
    """A document that parses but is not a mapping is a gap, not a crash (non-strict)."""
    return f"unreadable: not a mapping ({type(doc).__name__})"


def _within(root: Path, path: Path) -> bool:
    """Does `path` still lie under `root` once every link on both sides is followed?

    The rule `observatory_discovery._within` applies to every root the Observatory
    scans, stated here for the one directory of a course whose entries this loader does
    not control. A path that cannot be resolved is not contained: the caller checks
    existence first, so what is left is a link this process may not follow.
    """
    try:
        resolved_root = root.resolve(strict=True)
        resolved = path.resolve(strict=True)
    except OSError:
        return False
    return resolved == resolved_root or resolved_root in resolved.parents


def load_course(course_dir: Path | str, *, strict: bool = True) -> CourseDocs:
    """Read `astra.yaml`, `universes/*.yaml`, the trace and the review of one course."""
    course_dir = Path(course_dir)
    absent: dict[str, str] = {}

    def _read(rel: str) -> dict[str, Any] | None:
        try:
            doc = load_yaml(course_dir / rel)
        except Exception as exc:  # OSError, yaml.YAMLError
            if strict:
                raise
            absent[rel] = _unreadable(exc)
            return None
        if doc is None:
            absent[rel] = MISSING
            return None
        if not isinstance(doc, Mapping) and not strict:
            absent[rel] = _not_a_mapping(doc)
            return None
        return doc

    def _read_json(rel: str) -> dict[str, Any] | None:
        path = course_dir / rel
        if not path.is_file():
            absent[rel] = MISSING
            return None
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # OSError, json.JSONDecodeError
            if strict:
                raise
            absent[rel] = _unreadable(exc)
            return None
        if not isinstance(doc, Mapping):
            if strict:
                raise ValueError(f"{rel} is not a mapping ({type(doc).__name__})")
            absent[rel] = _not_a_mapping(doc)
            return None
        return doc

    astra = _read(ASTRA_FILE)
    if astra is None and strict:
        raise FileNotFoundError(f"no astra.yaml under {course_dir}")

    universes: list[dict[str, Any]] = []
    universes_dir = course_dir / UNIVERSES_DIR
    for upath in sorted(universes_dir.glob("*.yaml")) if universes_dir.is_dir() else []:
        rel = f"{UNIVERSES_DIR}/{upath.name}"
        try:
            doc = load_yaml(upath)
        except Exception as exc:
            if strict:
                raise
            absent[rel] = _unreadable(exc)
            continue
        if doc is not None and not isinstance(doc, Mapping) and not strict:
            absent[rel] = _not_a_mapping(doc)
            continue
        universe = dict(doc or {})
        universe.setdefault("id", upath.stem)
        universes.append(universe)

    def _contained(rel: str) -> bool:
        """Is `<course>/rel` still inside the course once every link is followed?

        A path that does not exist is left to its reader, which names it `MISSING`;
        one that exists elsewhere is named and not opened, so nothing outside the
        course reaches a caller. **Strict behaves the same way** (INT-STUDIUM-028).

        Strict means "do not guess", and this is not a guess: an escaping path is a
        GAP in the artifact, reported under its own name, exactly as the non-strict
        path reports it. Containment is identical in both branches — the file is not
        opened either way. Strict still raises where the loader genuinely cannot say
        what a file holds (a YAML or OS error), because that is a fault, not a gap.

        It used to raise, and the survey the intent required found the raise served
        nobody: the only non-test strict caller is `tools/astra_render.py:107`, whose
        two consumers are a CLI that exited on a traceback and the Observatory's
        `provenance.myst.md` route, which caught it and degraded the whole page to
        "(unreadable course: ValueError)" while the marker list beneath it — built
        with `strict=False` — correctly named the path OUTSIDE. A readable course
        rendered as unreadable, and the page contradicted itself two lines apart.
        """
        path = course_dir / rel
        if not path.exists() or _within(course_dir, path):
            return True
        LOGGER.warning("review artifact leaves the course directory: %s", path)
        absent[rel] = OUTSIDE
        return False

    reviews: list[ReviewDoc] = []
    reviews_dir = course_dir / REVIEW_DIR
    on_disk = False  # a per-bundle review artifact exists, readable or not
    bundle_dirs: list[Path] = []
    review_root_ok = _contained(REVIEW_DIR)
    if review_root_ok and reviews_dir.is_dir():
        try:
            children = sorted(p for p in reviews_dir.iterdir() if p.is_dir())
        except OSError as exc:
            if strict:
                raise
            absent[REVIEW_DIR] = _unreadable(exc)
            children = []
        bundle_dirs = [p for p in children if _contained(f"{REVIEW_DIR}/{p.name}")]

    for bdir in bundle_dirs:
        astra_rel = f"{REVIEW_DIR}/{bdir.name}/{REVIEW_BASENAME}"
        verdicts_rel = f"{REVIEW_DIR}/{bdir.name}/{VERDICTS_BASENAME}"
        astra_ok, verdicts_ok = _contained(astra_rel), _contained(verdicts_rel)
        on_disk = on_disk or (astra_ok and (bdir / REVIEW_BASENAME).is_file()) \
            or (verdicts_ok and (bdir / VERDICTS_BASENAME).is_file())
        # Both halves, whatever the other one does: the ASTRA document is the same
        # verdicts in another notation, so a fault in it says nothing about the JSON.
        doc = _read(astra_rel) if astra_ok else None
        verdicts = _read_json(verdicts_rel) if verdicts_ok else None
        if doc is None and verdicts is None:
            continue          # a directory holding nothing readable is not a review
        reviews.append(ReviewDoc(bundle_id=bdir.name, rel=astra_rel, astra=doc,
                                 verdicts=verdicts))

    # The legacy file is read whenever it exists, and its verdict on `review` is final:
    # a course that has the flat file is a course whose review is that file, broken or
    # not, and a per-bundle document must not paper over it. Its name is also the one
    # reported as missing when the course has no review of either kind — one review is
    # still what most courses have, and `review/astra.yaml` is the name the operator knows.
    legacy_ok = review_root_ok and _contained(REVIEW_FILE)
    legacy_exists = legacy_ok and (course_dir / REVIEW_FILE).is_file()
    legacy = _read(REVIEW_FILE) if legacy_ok and (legacy_exists or not on_disk) else None
    if legacy is not None:
        reviews.insert(0, ReviewDoc(bundle_id="", rel=REVIEW_FILE, astra=legacy))

    return CourseDocs(
        course_dir=course_dir,
        astra=astra,
        universes=tuple(universes),
        trace=_read(TRACE_FILE),
        # One document for the readers that show one. A bundle whose ASTRA half is
        # unreadable now keeps its ReviewDoc, so the first readable document is taken
        # rather than the first bundle's: `None` here means no review is renderable,
        # never "the first one happened to be the broken one".
        review=legacy if legacy_exists
        else next((r.astra for r in reviews if r.astra is not None), None),
        reviews=tuple(reviews),
        absent=absent,
    )
