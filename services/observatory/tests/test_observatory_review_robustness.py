"""The Review surface against artifacts nobody's emitter wrote.

`review/<bundle_id>/{astra.yaml,verdicts.json}` is the one place under a course whose
contents are named and written by whoever ran the judge, and both files are text an
author can edit. An independent review of slice 2 found three ways that surface lied
rather than failed soft; each is pinned here, at the reader and at both routes.

* **The two halves are independent.** `load_course` read the ASTRA document first and
  skipped the bundle when it was absent or malformed, taking a perfectly readable
  `verdicts.json` with it — an existing artifact turned into a silent gap, which is the
  fault INT-STUDIUM-020 fixed for the flat legacy file and reintroduced per bundle.
* **A malformed value is not a measurement.** `bool("false")` is `True`, `float("nan")`
  is a float, and a missing pair count is not `0`. A non-finite float also cannot be
  serialised by `JSONResponse` at all, so one NaN in a review file answered the API
  twin with a 500 instead of a marker (spec N3).
* **A review artifact stays inside its course.** `is_file()` and `is_dir()` follow
  symlinks, so a link under `review/` made the loader read, and the page render, a
  document from anywhere on the host. Discovery already applies exactly this rule to
  the roots it scans (`observatory_discovery._within`); the review tree is the same
  class of input and gets the same rule.

Every diagnostic asserted here names the FIELD and the TYPE, never the value, the
source line or an exception message: these strings are rendered on an operator page
and the document they describe is author-supplied text.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest
import yaml
from harness.scene_judge import judge_bundle, write_review
from observatory_discovery import CourseRef
from observatory_paths import EVAL_DIR
from observatory_provenance import reviews_detail
from provenance.astra_read import OUTSIDE, load_course

SECRET = "SECRET-OUTSIDE-THE-COURSE-4b71"

_JUDGE_FIXTURES = None


def _fixtures():
    """`eval/tests/test_scene_judge.py` loaded by path — the same idiom as
    `test_observatory_review.py`: importing it under its own name collides with the
    planner's test package when both suites run together."""
    global _JUDGE_FIXTURES
    if _JUDGE_FIXTURES is None:
        spec = importlib.util.spec_from_file_location(
            "observatory_scene_judge_robustness_fixtures",
            EVAL_DIR / "tests" / "test_scene_judge.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _JUDGE_FIXTURES = module
    return _JUDGE_FIXTURES


def _course(course_root: Path, course_id: str) -> Path:
    """A course as `discover` recognises one: a directory with `astra.yaml` at its root.

    Deliberately not the full emitted set — every assertion below is about the review
    tree, and the course's own analyses never reach the Review page."""
    course = course_root / course_id
    course.mkdir(parents=True)
    (course / "astra.yaml").write_text(
        yaml.safe_dump({"astra_version": "0.0.14", "id": course_id, "name": course_id,
                        "analyses": {}}), encoding="utf-8")
    return course


def _review(course: Path, bundle_id: str = "b1") -> Path:
    """One review under `course`, written by the judge's own writer, so what is read
    back is the layout Studium produces and not a hand-built imitation."""
    write_review(judge_bundle({"bundle_id": bundle_id, "language": "fr",
                               "scenes": [_fixtures().QUIZ]}, _fixtures().FakeLLM()), course)
    return course / "review" / bundle_id


def _rewrite_verdicts(course: Path, slug: str, **fields: Any) -> Path:
    """Replace fields of a written `verdicts.json`. `json.dumps` emits `NaN` and
    `Infinity` unasked, which is exactly how one reaches a review file."""
    path = course / "review" / slug / "verdicts.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document.update(fields)
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def _outside(tmp_path: Path) -> Path:
    """A directory outside the course root holding a readable review of its own."""
    outside = tmp_path / "outside-the-course-root" / "b9"
    outside.mkdir(parents=True)
    (outside / "verdicts.json").write_text(
        json.dumps({"bundle_id": SECRET, "scenes": {SECRET: []}, "worst_case": {},
                    "skipped": {}}), encoding="utf-8")
    (outside / "astra.yaml").write_text(
        yaml.safe_dump({"astra_version": "0.0.14", "id": SECRET,
                        "analyses": {SECRET: {"decisions": {SECRET: {"default": "pass"}}}}}),
        encoding="utf-8")
    return outside


def _ref(course_root: Path, course_id: str) -> CourseRef:
    return CourseRef(course_id, course_root / course_id, "root")


def _pages(client, course_id: str) -> tuple[dict[str, Any], str]:
    """The JSON twin and the HTML, both of which must answer 200 whatever is on disk."""
    api = client.get(f"/api/courses/{course_id}/review")
    page = client.get(f"/courses/{course_id}/review")
    assert (api.status_code, page.status_code) == (200, 200)
    return api.json(), page.text


def _bundle(detail: dict[str, Any], bundle_id: str) -> dict[str, Any]:
    matching = [b for b in detail["bundles"] if b["bundle_id"] == bundle_id]
    assert len(matching) == 1, [b["bundle_id"] for b in detail["bundles"]]
    return matching[0]


def _problem(bundle: dict[str, Any], field: str) -> str | None:
    """The reason recorded against one field of a bundle's review, or None."""
    return next((p["reason"] for p in bundle["problems"] if p["field"] == field), None)


def _shown(reason: str) -> str:
    """A reason as `base.html`'s `markers` macro renders it."""
    return reason.removeprefix("unreadable: ")


#: How Python renders a non-finite float, as a WORD: the page's own footer link says
#: "back to prove-nan-ce", so a bare substring search can never pass here.
NON_FINITE_WORD = re.compile(r"\b(nan|inf|infinity)\b", re.IGNORECASE)


# ------------------------------------------------- the two halves of a review are read
# independently: neither file may take the other down with it (INT-STUDIUM-020, spec N3)

def test_a_missing_astra_document_does_not_hide_readable_verdicts(client, course_root) -> None:
    course = _course(course_root, "course-no-astra")
    (_review(course) / "astra.yaml").unlink()

    detail = reviews_detail(_ref(course_root, "course-no-astra"))
    bundle = _bundle(detail, "b1")
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s1"]   # the verdicts still show
    assert bundle["astra_rows"] is None
    assert detail["absent"]["review/b1/astra.yaml"] == "missing"
    # The bundle IS the course's review, so the legacy path is not reported as missing too.
    assert "review/astra.yaml" not in detail["absent"]

    api, page = _pages(client, "course-no-astra")
    assert api == detail
    assert "s1" in page
    assert "(missing review/b1/astra.yaml)" in page


def test_a_malformed_astra_document_does_not_hide_readable_verdicts(client, course_root) -> None:
    course = _course(course_root, "course-bad-astra")
    (_review(course) / "astra.yaml").write_text("id: [unclosed\n", encoding="utf-8")

    detail = reviews_detail(_ref(course_root, "course-bad-astra"))
    bundle = _bundle(detail, "b1")
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s1"]
    assert bundle["astra_rows"] is None
    assert detail["absent"]["review/b1/astra.yaml"].startswith("unreadable:")

    api, page = _pages(client, "course-bad-astra")
    assert api == detail
    assert "s1" in page
    assert "(unreadable review/b1/astra.yaml: " in page


def test_a_bundle_with_neither_half_readable_is_not_listed_as_a_review(client, course_root) -> None:
    """The correction reads the two halves apart; it does not invent a review out of a
    directory that holds nothing readable at all."""
    course = _course(course_root, "course-empty-bundle")
    rdir = _review(course)
    (rdir / "astra.yaml").write_text("id: [unclosed\n", encoding="utf-8")
    (rdir / "verdicts.json").write_text("{", encoding="utf-8")

    detail = reviews_detail(_ref(course_root, "course-empty-bundle"))
    assert detail["bundles"] == []
    assert detail["absent"]["review/b1/astra.yaml"].startswith("unreadable:")
    assert detail["absent"]["review/b1/verdicts.json"].startswith("unreadable:")

    api, page = _pages(client, "course-empty-bundle")
    assert api == detail
    assert "(unreadable review/b1/verdicts.json: " in page


# ------------------------------------------- a review artifact never leaves its course

def test_a_review_directory_that_leaves_the_course_is_not_read(client, course_root,
                                                               tmp_path) -> None:
    course = _course(course_root, "course-link-root")
    (course / "review").symlink_to(_outside(tmp_path).parent, target_is_directory=True)

    detail = reviews_detail(_ref(course_root, "course-link-root"))
    assert detail["bundles"] == []
    assert detail["absent"]["review"] == OUTSIDE
    assert SECRET not in json.dumps(detail)

    api, page = _pages(client, "course-link-root")
    assert api == detail
    assert f"(unreadable review: {_shown(OUTSIDE)})" in page
    assert SECRET not in page


def test_a_bundle_directory_that_leaves_the_course_is_not_read(client, course_root,
                                                               tmp_path) -> None:
    course = _course(course_root, "course-link-bundle")
    _review(course)
    (course / "review" / "b9").symlink_to(_outside(tmp_path), target_is_directory=True)

    detail = reviews_detail(_ref(course_root, "course-link-bundle"))
    assert [b["dir_slug"] for b in detail["bundles"]] == ["b1"]   # the real one survives
    assert detail["absent"]["review/b9"] == OUTSIDE
    assert SECRET not in json.dumps(detail)

    api, page = _pages(client, "course-link-bundle")
    assert api == detail
    assert f"(unreadable review/b9: {_shown(OUTSIDE)})" in page
    assert SECRET not in page


def test_a_verdicts_file_that_leaves_the_course_is_not_read(client, course_root,
                                                            tmp_path) -> None:
    course = _course(course_root, "course-link-verdicts")
    rdir = _review(course)
    (rdir / "verdicts.json").unlink()
    (rdir / "verdicts.json").symlink_to(_outside(tmp_path) / "verdicts.json")

    detail = reviews_detail(_ref(course_root, "course-link-verdicts"))
    bundle = _bundle(detail, "b1")
    assert bundle["scenes"] == []
    assert bundle["verdicts_absent"] == OUTSIDE
    assert bundle["astra_rows"]["n_decisions"] >= 1        # the contained half still reads
    assert SECRET not in json.dumps(detail)

    api, page = _pages(client, "course-link-verdicts")
    assert api == detail
    assert f"(unreadable review/b1/verdicts.json: {_shown(OUTSIDE)})" in page
    assert SECRET not in page


def test_an_astra_file_that_leaves_the_course_is_not_read(client, course_root,
                                                          tmp_path) -> None:
    course = _course(course_root, "course-link-astra")
    rdir = _review(course)
    (rdir / "astra.yaml").unlink()
    (rdir / "astra.yaml").symlink_to(_outside(tmp_path) / "astra.yaml")

    detail = reviews_detail(_ref(course_root, "course-link-astra"))
    bundle = _bundle(detail, "b1")
    assert bundle["astra_rows"] is None
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s1"]   # the contained half reads
    assert detail["absent"]["review/b1/astra.yaml"] == OUTSIDE
    assert SECRET not in json.dumps(detail)

    api, page = _pages(client, "course-link-astra")
    assert api == detail
    assert f"(unreadable review/b1/astra.yaml: {_shown(OUTSIDE)})" in page
    assert SECRET not in page


def test_a_legacy_review_file_that_leaves_the_course_is_not_read(client, course_root,
                                                                 tmp_path) -> None:
    course = _course(course_root, "course-link-legacy")
    (course / "review").mkdir()
    (course / "review" / "astra.yaml").symlink_to(_outside(tmp_path) / "astra.yaml")

    detail = reviews_detail(_ref(course_root, "course-link-legacy"))
    assert detail["bundles"] == []
    assert detail["absent"]["review/astra.yaml"] == OUTSIDE
    assert SECRET not in json.dumps(detail)

    api, page = _pages(client, "course-link-legacy")
    assert api == detail
    assert f"(unreadable review/astra.yaml: {_shown(OUTSIDE)})" in page
    assert SECRET not in page
    # The course page reads the same loader and must not render the outside document either.
    assert SECRET not in client.get("/courses/course-link-legacy").text


def test_the_strict_loader_refuses_an_artifact_that_leaves_the_course(course_root,
                                                                      tmp_path) -> None:
    """The renderer loads strictly, and strict has always meant "raise, do not guess".
    Containment is not an exception to it: a silent skip there would be a silent gap."""
    course = _course(course_root, "course-link-strict")
    rdir = _review(course)
    (rdir / "verdicts.json").unlink()
    (rdir / "verdicts.json").symlink_to(_outside(tmp_path) / "verdicts.json")

    with pytest.raises(ValueError):
        load_course(course, strict=True)


# ------------------------------------- a value that is not a measurement is not shown as one

@pytest.mark.parametrize("label, kappa", [("a", float("nan")), ("b", float("inf")),
                                          ("c", float("-inf"))])
def test_a_non_finite_kappa_is_never_served_as_a_number(client, course_root, label,
                                                        kappa) -> None:
    """A non-finite float in a review file reached the two twins differently.

    The route's `-> dict` annotation sends the payload through pydantic
    (`ser_json_inf_nan='null'`) before Starlette's `allow_nan=False` ever sees it, so the
    API twin answered 200 with `null` — a calibration that ran and found nothing — while
    `%.4g` wrote the literal `nan` on the page. Neither was a marker.
    """
    course_id = f"course-kappa-{label}"
    course = _course(course_root, course_id)
    _review(course)
    _rewrite_verdicts(course, "b1", calibration={"pairs": 3, "kappa": kappa,
                                                 "separates": True})

    api, page = _pages(client, course_id)
    bundle = _bundle(api, "b1")
    assert bundle["calibration"]["kappa"] is None
    assert bundle["calibration"]["pairs"] == 3            # the readable field survives
    assert _problem(bundle, "calibration.kappa")
    assert "kappa not computed" in page
    assert NON_FINITE_WORD.search(page) is None


def test_a_kappa_outside_its_range_is_not_a_measurement(client, course_root) -> None:
    course = _course(course_root, "course-kappa-range")
    _review(course)
    _rewrite_verdicts(course, "b1", calibration={"pairs": 3, "kappa": 42.0,
                                                 "separates": True})

    api, page = _pages(client, "course-kappa-range")
    bundle = _bundle(api, "b1")
    assert bundle["calibration"]["kappa"] is None
    assert _problem(bundle, "calibration.kappa")
    assert "42" not in page                               # never the value, only the field


def test_a_string_separates_is_not_read_as_a_boolean(client, course_root) -> None:
    """`bool("false")` is `True`: the one coercion that turns a failed calibration into
    a passing one on screen."""
    course = _course(course_root, "course-separates-string")
    _review(course)
    _rewrite_verdicts(course, "b1", calibration={"pairs": 3, "kappa": 0.71,
                                                 "separates": "false"})

    api, page = _pages(client, "course-separates-string")
    bundle = _bundle(api, "b1")
    assert bundle["calibration"]["separates"] is None
    assert _problem(bundle, "calibration.separates")
    assert "separates: yes" not in page
    assert "separates: not recorded" in page


def test_an_absent_separates_is_not_reported_as_a_negative_result(client,
                                                                  course_root) -> None:
    course = _course(course_root, "course-separates-absent")
    _review(course)
    _rewrite_verdicts(course, "b1", calibration={"pairs": 3, "kappa": 0.71})

    api, page = _pages(client, "course-separates-absent")
    bundle = _bundle(api, "b1")
    assert bundle["calibration"]["separates"] is None     # not recorded, not "no"
    assert bundle["problems"] == []                       # an absent field is not a fault
    assert "separates: not recorded" in page


def test_a_pair_count_that_is_not_a_count_is_not_reported_as_zero(client,
                                                                  course_root) -> None:
    course = _course(course_root, "course-pairs")
    _review(course)
    _rewrite_verdicts(course, "b1", calibration={"pairs": "three", "kappa": 0.71,
                                                 "separates": True})

    api, page = _pages(client, "course-pairs")
    bundle = _bundle(api, "b1")
    assert bundle["calibration"]["pairs"] is None
    assert _problem(bundle, "calibration.pairs")
    assert "0 pair(s)" not in page
    assert "three" not in page


def test_a_non_finite_confidence_is_never_served_as_a_number(client, course_root) -> None:
    course = _course(course_root, "course-confidence")
    _review(course)
    _rewrite_verdicts(course, "b1", scenes={"s1": [
        {"scene_id": "s1", "dimension": "key_correctness", "verdict": "pass",
         "failure_scenario": "", "quote": "", "confidence": float("nan")}]})

    api, page = _pages(client, "course-confidence")
    bundle = _bundle(api, "b1")
    assert bundle["scenes"][0]["verdicts"][0]["confidence"] is None
    assert _problem(bundle, "scenes.s1[0].confidence")
    assert NON_FINITE_WORD.search(page) is None


def test_a_boolean_confidence_is_not_a_confidence(client, course_root) -> None:
    """`True` is an `int` in Python, so an unguarded numeric check reads it as 1.0."""
    course = _course(course_root, "course-confidence-bool")
    _review(course)
    _rewrite_verdicts(course, "b1", scenes={"s1": [
        {"scene_id": "s1", "dimension": "key_correctness", "verdict": "pass",
         "failure_scenario": "", "quote": "", "confidence": True}]})

    api, _page = _pages(client, "course-confidence-bool")
    bundle = _bundle(api, "b1")
    assert bundle["scenes"][0]["verdicts"][0]["confidence"] is None
    assert _problem(bundle, "scenes.s1[0].confidence")


def test_wrong_nested_containers_are_named_and_the_safe_scenes_survive(client,
                                                                       course_root) -> None:
    """The three blocks that were silently emptied. The judged scenes are untouched by
    any of them and must still be on the page."""
    course = _course(course_root, "course-containers")
    _review(course)
    _rewrite_verdicts(course, "b1", skipped="not a mapping", worst_case=["not", "a", "mapping"],
                      calibration=3)

    api, page = _pages(client, "course-containers")
    bundle = _bundle(api, "b1")
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s1"]
    assert (bundle["worst_case"], bundle["calibration"], bundle["skipped"]) == (None, None, [])
    assert _problem(bundle, "worst_case") == "unreadable: not a mapping (list)"
    assert _problem(bundle, "calibration") == "unreadable: not a mapping (int)"
    assert _problem(bundle, "skipped") == "unreadable: not a mapping (str)"
    assert "s1" in page
    for field in ("worst_case", "calibration", "skipped"):
        assert f"review/b1/verdicts.json {field}: not a mapping" in page


def test_a_scenes_block_of_the_wrong_type_is_named_not_silently_empty(client,
                                                                      course_root) -> None:
    course = _course(course_root, "course-scenes-type")
    _review(course)
    _rewrite_verdicts(course, "b1", scenes=["s1", "s2"])

    api, page = _pages(client, "course-scenes-type")
    bundle = _bundle(api, "b1")
    assert bundle["scenes"] == []
    assert bundle["worst_overall"] is None                # unreadable is never "pass"
    assert _problem(bundle, "scenes") == "unreadable: not a mapping (list)"
    assert bundle["astra_rows"]["n_decisions"] >= 1       # the ASTRA half is untouched
    assert "review/b1/verdicts.json scenes: not a mapping" in page


def test_an_unknown_verdict_is_neither_ranked_nor_displayed(client, course_root) -> None:
    """`worst()` ranks on the judge's own scale and has no rank for a fourth word. It
    must not be shown as a verdict either: an operator would read it as one."""
    course = _course(course_root, "course-unknown-verdict")
    _review(course)
    _rewrite_verdicts(course, "b1", scenes={"s1": [
        {"scene_id": "s1", "dimension": "key_correctness", "verdict": "catastrophic",
         "failure_scenario": "", "quote": "", "confidence": 0.9}]})

    api, page = _pages(client, "course-unknown-verdict")
    bundle = _bundle(api, "b1")
    assert bundle["scenes"][0]["verdicts"][0]["verdict"] == ""
    assert bundle["scenes"][0]["worst"] is None
    assert bundle["worst_overall"] is None
    assert _problem(bundle, "scenes.s1[0].verdict")
    assert "catastrophic" not in page


def test_an_unknown_worst_case_verdict_is_named_not_shown(client, course_root) -> None:
    course = _course(course_root, "course-unknown-worst-case")
    _review(course)
    _rewrite_verdicts(course, "b1", worst_case={"key_correctness": "catastrophic",
                                                "distractor_quality": "pass"})

    api, page = _pages(client, "course-unknown-worst-case")
    bundle = _bundle(api, "b1")
    assert bundle["worst_case"] == {"distractor_quality": "pass"}
    assert _problem(bundle, "worst_case")
    assert "catastrophic" not in page


# ------------------------------------------------------------- the bundle's own identity

def test_a_verdicts_bundle_id_that_this_directory_does_not_store_is_a_conflict(
        client, course_root) -> None:
    """`write_review` puts a review under `bundle_slug(bundle_id)`. When the id inside
    no longer slugifies to the directory it was found in, one of the two is wrong and
    the reader cannot tell which: the location is the fact on disk, and the conflict is
    named rather than resolved in the claim's favour."""
    course = _course(course_root, "course-identity-conflict")
    _review(course)
    _rewrite_verdicts(course, "b1", bundle_id="some-other-bundle")

    api, page = _pages(client, "course-identity-conflict")
    bundle = _bundle(api, "b1")
    assert bundle["dir_slug"] == "b1"
    assert _problem(bundle, "bundle_id")
    assert "(unreadable review/b1/verdicts.json bundle_id: " in page
    assert "some-other-bundle" not in page
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s1"]   # the verdicts still show


def test_a_slugged_bundle_id_is_still_the_identity(client, course_root) -> None:
    """The happy path the conflict rule must not break: an id the writer had to slugify
    is not a conflict, because it slugifies to the directory it is stored under."""
    course = _course(course_root, "course-slugged-identity")
    _review(course, "Unit 1/Intro")

    api, page = _pages(client, "course-slugged-identity")
    bundle = _bundle(api, "Unit 1/Intro")
    assert bundle["dir_slug"] == "Unit-1-Intro"
    assert bundle["bundle_id_source"] == "verdicts.json"
    assert bundle["problems"] == []
    assert "Unit 1/Intro" in page
