"""astra_read.py — read one course's provenance artifacts from a planner output dir.

Two readers share this loader: `tools/astra_render.py` (the MySTRA page) and the Studium
Observatory (`services/observatory`). The directory layout the planner writes is
therefore described in exactly one place — INT-STUDIUM-008, constraint R9 "reuse, no
third copy".

Layout, as `provenance.astra_emit.write_astra_set` writes it:

  astra.yaml                    ASTRA document (ASB `analyses:` shape; flat legacy accepted)
  universes/*.yaml              option selections (nested shape; flat legacy accepted)
  trace/exploration_tree.yaml   ARA exploration trace (schema 0.1.0)
  review/astra.yaml             scene-review verdicts (optional, eval/harness/scene_judge.py)

`strict=True` (the default) reproduces the renderer's behaviour: a missing `astra.yaml`
raises `FileNotFoundError`, a YAML or OS error propagates. `strict=False` never raises:
the field stays `None`, an unreadable universe is skipped, and every gap is named in
`absent` under its path relative to the course directory. A document that parses to
something other than a mapping (a list, a bare string) counts as unreadable there: no
emitter writes one, and a reader that cannot crash must still name it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

ASTRA_FILE = "astra.yaml"
UNIVERSES_DIR = "universes"
TRACE_FILE = "trace/exploration_tree.yaml"
REVIEW_FILE = "review/astra.yaml"

MISSING = "missing"

LOGGER = logging.getLogger(__name__)


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
    review: dict[str, Any] | None = None
    absent: dict[str, str] = field(default_factory=dict)


def load_yaml(path: Path) -> dict[str, Any] | None:
    """The document at `path`, or None when it is not a file."""
    import yaml
    if not path.is_file():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


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

    return CourseDocs(
        course_dir=course_dir,
        astra=astra,
        universes=tuple(universes),
        trace=_read(TRACE_FILE),
        review=_read(REVIEW_FILE),
        absent=absent,
    )
