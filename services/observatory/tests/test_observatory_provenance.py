"""The provenance reader over the really emitted ASTRA set (INT-STUDIUM-008, slice 1)."""
from __future__ import annotations

from pathlib import Path

import yaml
from astra_render import render
from observatory_discovery import CourseRef
from observatory_provenance import analyses_of, course_detail, myst_page, summarize_course
from provenance.astra_read import load_course


def _ref(root: Path, name: str) -> CourseRef:
    return CourseRef(name, root / name, "root")


def test_summary_counts_the_emitted_course(course_root: Path) -> None:
    docs = load_course(course_root / "course-a")
    summary = summarize_course(_ref(course_root, "course-a"))

    assert summary.id == "course-a"
    assert summary.name == docs.astra["name"]
    assert summary.version == docs.astra["version"]
    assert summary.n_analyses == len(docs.astra["analyses"])
    assert summary.n_decisions == sum(
        len(a.get("decisions") or {}) for a in docs.astra["analyses"].values())
    assert summary.n_findings == sum(
        len(a.get("findings") or {}) for a in docs.astra["analyses"].values())
    assert summary.universes == ("baseline", "remedial")
    assert summary.has_trace and summary.has_review
    assert summary.absent == {}

    partial = summarize_course(_ref(course_root, "course-b"))
    assert not partial.has_review
    assert partial.absent["review/astra.yaml"] == "missing"
    assert partial.absent["universes/broken.yaml"].startswith("unreadable:")
    assert partial.universes == ("baseline", "remedial")


def test_detail_exposes_decisions_universes_trace_review(course_root: Path) -> None:
    docs = load_course(course_root / "course-a")
    detail = course_detail(_ref(course_root, "course-a"))

    written = {slug for body in docs.astra["analyses"].values()
               for slug in (body.get("decisions") or {})}
    shown = {d["id"] for a in detail["analyses"] for d in a["decisions"]}
    assert shown == written
    assert all(isinstance(d["source_edge_id"], str) and d["source_edge_id"]
               for a in detail["analyses"] for d in a["decisions"])
    assert "Prerequisite gating strictness" in {
        d["label"] for a in detail["analyses"] for d in a["decisions"]}

    assert [u["id"] for u in detail["universes"]] == ["baseline", "remedial"]
    assert detail["universes"][0]["diff_from_default"] == {}
    assert detail["universes"][1]["diff_from_default"]["scaffolding"] == ["standard", "heavy"]
    assert detail["universes"][1]["selection"]["prereq_strictness"] == "lenient"

    assert "N01" in detail["trace_mermaid"]
    assert "N01" in detail["trace_bullets"]
    assert detail["review"]["n_decisions"] >= 1
    assert detail["review"]["n_non_pass"] == len(
        [r for r in detail["review"]["rows"] if r["default"] != "pass"])

    partial = course_detail(_ref(course_root, "course-b"))
    assert partial["review"] is None
    assert partial["absent"]["universes/broken.yaml"].startswith("unreadable:")


def test_flat_legacy_document(tmp_path: Path) -> None:
    """A document written before the analyses nesting still reads (astra_emit's rule)."""
    (tmp_path / "universes").mkdir()
    (tmp_path / "astra.yaml").write_text(yaml.safe_dump({
        "astra_version": "0.0.14", "id": "legacy", "name": "Legacy",
        "decisions": {"d1": {"label": "L", "default": "a",
                             "options": {"a": {"label": "A"}, "b": {"label": "B"}}}},
        "findings": {}}), encoding="utf-8")
    (tmp_path / "universes" / "u.yaml").write_text(
        yaml.safe_dump({"id": "u", "decisions": {"d1": "b"}}), encoding="utf-8")

    ref = CourseRef("legacy", tmp_path, "explicit")
    summary = summarize_course(ref)
    assert summary.n_analyses == 1
    assert summary.n_decisions == 1
    assert summary.n_findings == 0
    assert summary.universes == ("u",)

    detail = course_detail(ref)
    assert [a["slug"] for a in detail["analyses"]] == ["legacy"]
    assert detail["universes"][0]["diff_from_default"] == {"d1": ["a", "b"]}
    assert detail["trace_mermaid"] is None


def test_analyses_of_nested_and_flat(course_root: Path) -> None:
    nested = load_course(course_root / "course-a").astra
    assert [slug for slug, _ in analyses_of(nested)] == list(nested["analyses"])
    assert analyses_of({"id": "flat", "decisions": {}}) == [("flat", {"id": "flat", "decisions": {}})]


def test_myst_page_equals_render(course_root: Path) -> None:
    assert myst_page(_ref(course_root, "course-a")) == render(course_root / "course-a")


def test_myst_page_fails_soft_on_an_unparsable_file(course_root: Path) -> None:
    """course-b carries a malformed universe file: the renderer raises, the page does not."""
    page = myst_page(CourseRef("course-b", course_root / "course-b", "root"))
    assert page.startswith("# course-b")
    assert "(unreadable course: " in page
    assert "(unreadable universes/broken.yaml:" in page
