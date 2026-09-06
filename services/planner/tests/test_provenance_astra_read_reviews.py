"""INT-STUDIUM-020: the loader reads one review per bundle, and still reads the legacy one.

`review/astra.yaml` was the only resolver, so a course could hold exactly one review
document however many bundles it had. The canonical location is now
`review/<bundle_id>/{astra.yaml,verdicts.json}`; the flat file stays readable, because
courses reviewed before this change have one and a reader that stops reading them turns
an existing artifact into a silent gap.
"""
from __future__ import annotations

import json

import pytest
import yaml

from provenance.astra_read import load_course, review_dir

BROKEN_YAML = "id: [unclosed\n"


def _course(tmp_path):
    (tmp_path / "astra.yaml").write_text(
        yaml.safe_dump({"astra_version": "0.0.14", "id": "c", "name": "C", "analyses": {}}),
        encoding="utf-8")
    return tmp_path


def _write_review(course_dir, bundle_id, *, verdict="pass"):
    rdir = review_dir(course_dir, bundle_id)
    rdir.mkdir(parents=True, exist_ok=True)
    (rdir / "astra.yaml").write_text(
        yaml.safe_dump({"astra_version": "0.0.14", "id": f"{bundle_id}-scene-review",
                        "analyses": {f"{bundle_id}-scene-review": {}}}), encoding="utf-8")
    (rdir / "verdicts.json").write_text(
        json.dumps({"bundle_id": bundle_id, "worst_case": {"quiz_key": verdict}}),
        encoding="utf-8")
    return rdir


def test_every_bundle_review_is_read_not_just_one(tmp_path):
    course = _course(tmp_path)
    _write_review(course, "chap-02", verdict="defect")
    _write_review(course, "chap-01")

    docs = load_course(course)

    assert [r.bundle_id for r in docs.reviews] == ["chap-01", "chap-02"]  # sorted, both kept
    assert [r.rel for r in docs.reviews] == ["review/chap-01/astra.yaml",
                                             "review/chap-02/astra.yaml"]
    assert docs.reviews[1].verdicts["worst_case"] == {"quiz_key": "defect"}
    assert docs.absent == {}
    # The single legacy field keeps a document, so the renderer is untouched.
    assert docs.review is docs.reviews[0].astra


def test_the_legacy_flat_review_is_still_read(tmp_path):
    course = _course(tmp_path)
    (course / "review").mkdir()
    (course / "review" / "astra.yaml").write_text(
        yaml.safe_dump({"astra_version": "0.0.14", "id": "legacy", "analyses": {}}),
        encoding="utf-8")

    docs = load_course(course)

    assert docs.review is not None and docs.review["id"] == "legacy"
    assert [(r.bundle_id, r.rel) for r in docs.reviews] == [("", "review/astra.yaml")]
    assert docs.reviews[0].verdicts is None
    assert docs.absent == {}


def test_a_course_without_any_review_is_named_by_the_legacy_path(tmp_path):
    docs = load_course(_course(tmp_path), strict=False)

    assert docs.review is None and docs.reviews == ()
    assert docs.absent["review/astra.yaml"] == "missing"


def test_an_unreadable_bundle_review_is_named_non_strict_and_raises_strict(tmp_path):
    course = _course(tmp_path)
    _write_review(course, "chap-01")
    broken = review_dir(course, "chap-02")
    broken.mkdir(parents=True)
    (broken / "astra.yaml").write_text(BROKEN_YAML, encoding="utf-8")

    docs = load_course(course, strict=False)

    assert [r.bundle_id for r in docs.reviews] == ["chap-01"]
    assert docs.absent["review/chap-02/astra.yaml"].startswith("unreadable:")
    with pytest.raises(yaml.YAMLError):
        load_course(course, strict=True)


def test_unreadable_verdicts_do_not_lose_the_review(tmp_path):
    """The verdicts file is the Observatory's input; a broken one must not take the
    ASTRA document down with it."""
    course = _course(tmp_path)
    rdir = _write_review(course, "chap-01")
    (rdir / "verdicts.json").write_text("{not json", encoding="utf-8")

    docs = load_course(course, strict=False)

    assert [r.bundle_id for r in docs.reviews] == ["chap-01"]
    assert docs.reviews[0].astra is not None and docs.reviews[0].verdicts is None
    assert docs.absent["review/chap-01/verdicts.json"].startswith("unreadable:")
