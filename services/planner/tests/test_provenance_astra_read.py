"""The shared course loader — provenance.astra_read (INT-STUDIUM-008, slice 1).

The reading half of `tools/astra_render.py`: one loader over a planner output
directory, imported by the MySTRA renderer and by the Observatory so no third copy of
these paths exists. The fixtures are the real emitters (`astra_course_fixture`), so a
change in the emitted layout fails here first.

Run:  .venv/bin/python -m pytest services/planner/tests/test_provenance_astra_read.py -q
"""
from __future__ import annotations

import pytest
import yaml

from astra_course_fixture import build_course_set, build_review_set  # noqa: E402
from provenance.astra_read import (  # noqa: E402
    load_course, summary_lines, universe_selection, universe_summary, universe_summary_lines,
)

BROKEN_YAML = "id: [unclosed"


def test_load_course_reads_the_emitted_set(tmp_path):
    """The whole set the planner and the scene judge write is read in one call."""
    build_course_set(tmp_path)
    build_review_set(tmp_path)

    docs = load_course(tmp_path)

    assert docs.course_dir == tmp_path
    assert docs.astra["name"] == "Signal Processing"
    assert [u["id"] for u in docs.universes] == ["baseline", "remedial"]
    assert docs.trace["schema_version"]
    assert docs.review is not None
    assert docs.absent == {}


def test_non_strict_records_missing_and_unreadable(tmp_path):
    """Non-strict never raises: every gap is named in `absent`, the rest still loads."""
    build_course_set(tmp_path)  # no review set
    (tmp_path / "universes" / "broken.yaml").write_text(BROKEN_YAML, encoding="utf-8")

    docs = load_course(tmp_path, strict=False)

    assert docs.absent["review/astra.yaml"] == "missing"
    assert docs.absent["universes/broken.yaml"].startswith("unreadable:")
    assert [u["id"] for u in docs.universes] == ["baseline", "remedial"]
    assert docs.astra is not None

    empty = tmp_path / "empty"
    empty.mkdir()
    bare = load_course(empty, strict=False)
    assert bare.astra is None
    assert bare.absent["astra.yaml"] == "missing"
    assert bare.universes == ()


def test_strict_raises_like_render(tmp_path):
    """Strict is the renderer's behaviour today: a missing set and a broken file raise."""
    with pytest.raises(FileNotFoundError):
        load_course(tmp_path)

    build_course_set(tmp_path)
    (tmp_path / "universes" / "broken.yaml").write_text(BROKEN_YAML, encoding="utf-8")
    with pytest.raises(yaml.YAMLError):
        load_course(tmp_path)


def test_universe_selection_flat_and_nested():
    """Both universe shapes resolve to one decision -> option mapping."""
    assert universe_selection({"decisions": {"a": "x"}}) == {"a": "x"}
    assert universe_selection(
        {"analyses": {"s1": {"decisions": {"a": "y"}}, "s2": {"decisions": {"b": "z"}}}}
    ) == {"a": "y", "b": "z"}
    assert universe_selection({}) == {}


def test_a_universe_summary_is_what_it_changes_and_a_count_of_the_rest():
    """INT-STUDIUM-010 nit 3. A universe IS a delta from the defaults, but the emitter
    assigns every decision of the analysis so that no selection reads `[MISSING_DECISION]`
    — so the complete list is the default list repeated once per universe, and the delta is
    buried inside it. The section prints what moved and counts what did not."""
    doc = {"analyses": {"a": {"decisions": {"d1": {"default": "x"}, "d2": {"default": "y"},
                                           "d3": {"default": "z"}}}}}
    universe = {"id": "remedial",
                "analyses": {"a": {"decisions": {"d1": "x", "d2": "heavy", "d3": "z"}}}}

    assert universe_summary(universe, doc) == {"changed": {"d2": ["y", "heavy"]},
                                               "at_default": 2}
    assert universe_summary_lines(universe, doc) == [
        "  - d2: `heavy` (default `y`)", "  - 2 decisions at default"]

    # A universe that moves nothing says so as a count, not as an empty section.
    baseline = {"id": "baseline", "analyses": {"a": {"decisions": {"d1": "x", "d2": "y"}}}}
    assert universe_summary_lines(baseline, doc) == ["  - 2 decisions at default"]
    # It counts what this universe selected, not what the analysis declares: `d3` is
    # unnamed here, and the third decision is not part of this selection.
    assert universe_summary(baseline, doc)["at_default"] == 2


def test_a_selection_the_document_does_not_declare_counts_as_a_change():
    """`at_default` counts the decisions this universe SELECTED and did not move, never the
    decisions of the analysis. A universe naming a decision the document does not declare has
    no default to sit at, and calling it "at default" would assert agreement with a value
    that does not exist."""
    doc = {"analyses": {"a": {"decisions": {"d1": {"default": "x"}}}}}
    universe = {"id": "u", "analyses": {"a": {"decisions": {"d1": "x", "ghost": "v"}}}}
    assert universe_summary(universe, doc) == {"changed": {"ghost": [None, "v"]},
                                               "at_default": 1}
    # And the line says so rather than naming `None` as the default it moved from.
    assert universe_summary_lines(universe, doc)[0] == "  - ghost: `v` (no default recorded)"
    # And a decision the document declares but the universe never names is neither: it is
    # not part of this selection at all.
    assert universe_summary({"id": "u", "decisions": {}}, doc) == {"changed": {},
                                                                   "at_default": 0}
    assert summary_lines({"changed": {}, "at_default": 0}) == ["  - no selection"]


def test_the_flat_legacy_universe_shape_summarises_too():
    doc = {"id": "flat", "decisions": {"d1": {"default": "x"}, "d2": {"default": "y"}}}
    assert universe_summary({"id": "u", "decisions": {"d1": "moved", "d2": "y"}}, doc) == {
        "changed": {"d1": ["x", "moved"]}, "at_default": 1}


def test_a_wrong_shaped_summary_renders_rather_than_raising():
    """`summary_lines` reads a report written by an earlier version, and a report is a file
    on disk: a block of the wrong shape contributes nothing instead of taking the page."""
    assert summary_lines({}) == ["  - no selection"]
    assert summary_lines({"changed": "not a mapping", "at_default": 2}) == [
        "  - 2 decisions at default"]
    assert summary_lines({"changed": {"d": "not a pair"}, "at_default": 0}) == [
        "  - no selection"]


def test_unreadable_reason_names_the_type_and_nothing_else(tmp_path):
    """The reason string is the one text on an operator page we do not author.

    A PyYAML mark block quotes the offending SOURCE LINE of the document, and an
    OSError names the absolute path it failed on. Both reach the Observatory's pages
    and its JSON twins through `absent`, so neither belongs in the reason; the full
    message goes to the log instead (spec N3).
    """
    build_course_set(tmp_path)
    secret = "SECRET-COURSE-CONTENT-8e21"
    (tmp_path / "universes" / "leaky.yaml").write_text(
        f"id: leaky\nnote: [{secret}\n", encoding="utf-8")

    reason = load_course(tmp_path, strict=False).absent["universes/leaky.yaml"]

    assert reason.startswith("unreadable: ")
    assert secret not in reason, "the artifact's own text reached the reason"
    assert str(tmp_path) not in reason, "the absolute path reached the reason"
    assert "\n" not in reason
    # The type is what the operator needs to act, and it is kept.
    assert "Error" in reason
