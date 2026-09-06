"""The Review reader: every bundle's scene verdicts, worst case first.

`verdicts.json` gets its first reader here (INT-STUDIUM-020 gave it its home under
`<course>/review/<bundle_id>/`), and `bundle_id` — a field the Observatory has never
displayed — becomes the heading of each section.

Two things the layout makes easy to get wrong are pinned:

* the directory is NOT the identity. `write_review` slugifies an author-supplied bundle
  id into a safe directory name, so `load_course` reports the SLUG as `ReviewDoc.bundle_id`
  while the judge's own `verdicts.json` holds what was actually judged.
* a review file is author-editable, so it fails soft on a wrong *shape*, not only on a
  syntax error, and it never takes the bundle's ASTRA rows down with it (spec N3).

A verdict's `failure_scenario` and `quote` are LLM text about BUNDLE content — a quiz
stem, a planted flaw — never about a learner, and they are the thing an operator acts
on, so they are rendered. No telemetry field is read here at all.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import yaml
from astra_course_fixture import build_course_set
from harness.scene_judge import (
    VERDICTS, corrupt_scene, emit_review_astra, judge_bundle, worst, write_review,
)
from observatory_discovery import CourseRef
from observatory_paths import EVAL_DIR
from observatory_provenance import reviews_detail

_JUDGE_FIXTURES = None


def _fixtures():
    """`eval/tests/test_scene_judge.py` loaded by path: the bundles and the fake judge
    live there, and importing that file under its own name collides with the planner's
    test package when both suites run together (the idiom `astra_course_fixture` uses)."""
    global _JUDGE_FIXTURES
    if _JUDGE_FIXTURES is None:
        spec = importlib.util.spec_from_file_location(
            "observatory_scene_judge_fixtures", EVAL_DIR / "tests" / "test_scene_judge.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _JUDGE_FIXTURES = module
    return _JUDGE_FIXTURES


def _ref(root: Path, name: str) -> CourseRef:
    return CourseRef(name, root / name, "root")


def _judge(bundle_id: str, scenes: list[dict]) -> dict:
    return judge_bundle({"bundle_id": bundle_id, "language": "fr", "scenes": scenes},
                        _fixtures().FakeLLM())


def _write_review(course_dir: Path, bundle_id: str, scenes: list[dict]) -> dict:
    """One more review under `course_dir`, written by the judge's own writer, so what is
    read back is the layout Studium produces and not a hand-built imitation."""
    review = _judge(bundle_id, scenes)
    write_review(review, course_dir)
    return review


def _bundle(detail: dict[str, Any], bundle_id: str) -> dict[str, Any]:
    matching = [b for b in detail["bundles"] if b["bundle_id"] == bundle_id]
    assert len(matching) == 1, [b["bundle_id"] for b in detail["bundles"]]
    return matching[0]


def _verdicts_path(course_root: Path, slug: str) -> Path:
    return course_root / "course-a" / "review" / slug / "verdicts.json"


def test_every_bundle_on_disk_is_returned(course_root: Path) -> None:
    # `build_review_set` already wrote `b1` over a corrupted quiz, so it carries a defect.
    _write_review(course_root / "course-a", "b2", [_fixtures().QUIZ])   # every dimension passes
    detail = reviews_detail(_ref(course_root, "course-a"))

    assert detail["course_id"] == "course-a"
    assert [b["bundle_id"] for b in detail["bundles"]] == ["b1", "b2"]   # the defect first
    assert [b["worst_overall"] for b in detail["bundles"]] == ["defect", "pass"]


def test_scenes_are_ordered_worst_case_first(course_root: Path) -> None:
    corrupted_flaw, _dimension = corrupt_scene(_fixtures().FLAW)        # scene s2 -> defect
    _write_review(course_root / "course-a", "b3", [_fixtures().QUIZ, corrupted_flaw])
    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "b3")

    # s1 passes and s2 defects, so worst-case-first inverts the scene-id order.
    assert [s["scene_id"] for s in bundle["scenes"]] == ["s2", "s1"]
    severities = [VERDICTS.index(s["worst"]) for s in bundle["scenes"]]
    assert severities == sorted(severities, reverse=True)
    for scene in bundle["scenes"]:
        assert scene["worst"] == worst([v["verdict"] for v in scene["verdicts"]])
    assert bundle["worst_overall"] == "defect"


def test_the_bundle_id_is_carried(course_root: Path) -> None:
    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "b1")

    assert bundle["bundle_id"] == "b1"
    assert bundle["dir_slug"] == "b1"
    assert bundle["legacy"] is False
    assert bundle["rel"] == "review/b1/astra.yaml"
    assert (bundle["n_scenes"], bundle["n_defects"], bundle["n_skipped"]) == (1, 1, 0)
    assert bundle["worst_case"]["key_correctness"] == "defect"
    assert bundle["verdicts_absent"] is None


def test_the_displayed_bundle_id_is_the_judges_not_the_directory_slug(course_root: Path) -> None:
    """`write_review` slugifies an author-supplied id into a directory name that can hold
    no path separator, so the directory cannot be read back as the identity."""
    _write_review(course_root / "course-a", "Unit 1/Intro", [_fixtures().QUIZ])
    assert _verdicts_path(course_root, "Unit-1-Intro").is_file()

    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "Unit 1/Intro")
    assert bundle["dir_slug"] == "Unit-1-Intro"
    assert "/" not in bundle["dir_slug"]
    assert "verdicts.json" in bundle["bundle_id_source"]


def test_calibration_is_read_when_present(course_root: Path) -> None:
    path = _verdicts_path(course_root, "b1")
    document = json.loads(path.read_text(encoding="utf-8"))
    document["calibration"] = {"pairs": 3, "gold": [True, False, True],
                               "pred": [True, False, False], "kappa": 0.71, "separates": True}
    path.write_text(json.dumps(document), encoding="utf-8")

    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "b1")
    # The three fields an operator acts on; the raw per-pair booleans say nothing they use.
    assert bundle["calibration"] == {"kappa": 0.71, "separates": True, "pairs": 3}


def test_a_legacy_flat_review_is_read_and_labelled(tmp_path: Path) -> None:
    course = tmp_path / "legacy-course"
    course.mkdir()
    build_course_set(course)
    (course / "review").mkdir()
    (course / "review" / "astra.yaml").write_text(          # the pre-INT-STUDIUM-020 layout
        yaml.safe_dump(emit_review_astra(_judge("b1", [_fixtures().QUIZ])),
                       sort_keys=False, allow_unicode=True), encoding="utf-8")

    bundles = reviews_detail(_ref(tmp_path, "legacy-course"))["bundles"]
    assert len(bundles) == 1
    assert bundles[0]["legacy"] is True
    assert bundles[0]["bundle_id"] == ""
    assert "legacy" in bundles[0]["bundle_id_source"]
    assert bundles[0]["worst_overall"] is None            # no verdicts twin: not a pass
    assert bundles[0]["astra_rows"]["n_decisions"] >= 1
    assert bundles[0]["verdicts_absent"]


def test_an_unreadable_verdicts_file_does_not_take_the_bundle_down(course_root: Path) -> None:
    _verdicts_path(course_root, "b1").write_text("{", encoding="utf-8")

    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "b1")
    assert bundle["verdicts_absent"] == "unreadable: JSONDecodeError"
    assert bundle["astra_rows"]["n_decisions"] >= 1       # the ASTRA rows survive it
    assert bundle["scenes"] == []
    assert bundle["worst_overall"] is None
    assert bundle["bundle_id"] == "b1"                    # falls back to the directory name
    assert "directory" in bundle["bundle_id_source"]


def test_a_verdicts_document_of_the_wrong_shape_fails_soft(course_root: Path) -> None:
    """Not only a syntax error. A document that parses but whose blocks are the wrong type
    must not raise, must keep its ASTRA rows, and must never read as a pass."""
    _verdicts_path(course_root, "b1").write_text(
        json.dumps({"bundle_id": ["not", "a", "string"],
                    "scenes": {"s1": "not a list of verdicts"},
                    "worst_case": "not a mapping",
                    "skipped": ["not a mapping"],
                    "calibration": 3}), encoding="utf-8")

    bundle = _bundle(reviews_detail(_ref(course_root, "course-a")), "b1")
    assert bundle["bundle_id"] == "b1"                    # a list is not an identity
    assert bundle["worst_case"] is None
    assert bundle["calibration"] is None
    assert bundle["scenes"] == []
    assert bundle["worst_overall"] is None                # unreadable is never "pass"
    assert [s["scene_id"] for s in bundle["skipped"]] == ["s1"]
    reason = bundle["skipped"][0]["reason"]
    assert reason == "unreadable: not a list (str)"       # the TYPE, never a document quote
    assert bundle["astra_rows"]["n_decisions"] >= 1
