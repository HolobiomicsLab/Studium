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
from provenance.astra_read import load_course, universe_selection  # noqa: E402

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
