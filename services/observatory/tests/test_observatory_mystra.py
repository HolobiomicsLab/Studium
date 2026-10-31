"""MySTRA must expose complete artifact evidence without mutating a course."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest
import yaml
from observatory_discovery import CourseRef
from observatory_provenance import course_detail, reviews_detail


def _extend_course(root: Path) -> Path:
    course = root / "course-a"
    path = course / "astra.yaml"
    doc = yaml.safe_load(path.read_text())
    doc["analyses"]["second_analysis"] = {
        "name": "Second independent analysis",
        "decisions": {},
        "findings": {"anchored_claim": {
            "claim": "Review this evidence",
            "evidence": [{"id": "evidence_two", "artifact": "source_two",
                          "quote": {"exact": "A recorded quote <script>canary()</script>"}}],
        }},
    }
    path.write_text(yaml.safe_dump(doc))
    source = course / "review" / "b1" / "astra.yaml"
    review = yaml.safe_load(source.read_text())
    body = copy.deepcopy(next(iter(review["analyses"].values())))
    body["decisions"] = {"extra_check": {"label": "Additional review", "default": "defect",
                                          "options": {"defect": {"label": "Defect"}}}}
    review["analyses"]["second_review"] = body
    source.write_text(yaml.safe_dump(review))
    extra = course / "review" / "second_bundle"
    extra.mkdir()
    (extra / "astra.yaml").write_text(yaml.safe_dump(review))
    return course


def _snapshot(root: Path) -> dict:
    return {str(p.relative_to(root)): (p.stat().st_mtime_ns, hashlib.sha256(p.read_bytes()).hexdigest())
            for p in root.rglob("*") if p.is_file()}


def test_view_keeps_schema_quote_and_every_review_analysis(course_root):
    course = _extend_course(course_root)
    ref = CourseRef("course-a", course, "root")
    view = course_detail(ref)
    finding = next(a for a in view["analyses"] if a["slug"] == "second_analysis")["findings"][0]
    assert finding["evidence"][0]["quote_exact"] == "A recorded quote <script>canary()</script>"
    rows = view["review_summary"]["rows"]
    assert {(r["bundle_id"], r["analysis_id"]) for r in rows if r["id"] == "extra_check"} == {
        ("b1", "second_review"), ("second_bundle", "second_review")}
    assert sum(r["id"] == "extra_check" for b in reviews_detail(ref)["bundles"]
               for r in b["astra_rows"]["rows"]) == 2


def test_mystra_html_and_json_cover_complete_course(client, course_root):
    _extend_course(course_root)
    response = client.get("/courses/course-a/mystra")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    for expected in ("MySTRA", "Second independent analysis", "evidence_two", "second_bundle",
                     "extra_check", "A recorded quote", "provenance.myst.md"):
        assert expected in response.text
    assert "<script>canary()</script>" not in response.text
    assert "&lt;script&gt;canary()&lt;/script&gt;" in response.text
    payload = client.get("/api/courses/course-a/mystra").json()
    assert len(payload["review"]["bundles"]) == 2
    assert payload["validation"]["status"] == "not_run"
    assert len(payload["course"]["analyses"]) == 2


def test_mystra_is_read_only_and_does_not_start_validator(client, course_root, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("viewer started the validator without using the validation route")
    monkeypatch.setattr("observatory_validation.run_astra_validate", forbidden)
    before = _snapshot(course_root)
    for url in ("/courses/course-a/mystra", "/api/courses/course-a/mystra"):
        assert client.get(url).status_code == 200
    assert _snapshot(course_root) == before


def test_mystra_names_missing_review_and_unreadable_universe(client):
    page = client.get("/courses/course-b/mystra")
    assert page.status_code == 200
    assert "unreadable universes/broken.yaml" in page.text
    assert "missing review/astra.yaml" in page.text
    payload = client.get("/api/courses/course-b/mystra").json()
    assert payload["review"]["bundles"] == []
    assert payload["course"]["analyses"]


def test_mystra_unknown_course_stays_404(client):
    for url in ("/courses/unknown/mystra", "/api/courses/unknown/mystra"):
        assert client.get(url).status_code == 404


def test_mystra_never_reads_learner_telemetry(client, course_root):
    canary = "UNPUBLISHED-LEARNER-TEXT-9fca"
    sessions = course_root / "course-a" / "sessions"
    sessions.mkdir()
    (sessions / "telemetry.jsonl").write_text(json.dumps({"text": canary, "learner_id": canary}))
    for url in ("/courses/course-a/mystra", "/api/courses/course-a/mystra"):
        page = client.get(url)
        assert page.status_code == 200
        assert canary not in page.text


def test_review_evidence_survives_without_verdicts_file(course_root):
    course = course_root / "course-a"
    (course / "review" / "b1" / "verdicts.json").unlink()
    review = reviews_detail(CourseRef("course-a", course, "root"))["bundles"][0]
    assert review["astra_rows"]["findings"]
    assert any(row["rationale"] == "learner is credited for a wrong answer"
               for row in review["astra_rows"]["rows"])
    assert review["verdicts_absent"] == "missing"


def test_legacy_review_failure_keeps_readable_bundle_summary(client, course_root):
    """The old API field retains its contract; the new summary names all readable rows."""
    (course_root / "course-a" / "review" / "astra.yaml").write_text("- malformed legacy\n")
    response = client.get("/api/courses/course-a")
    assert response.status_code == 200
    assert response.json()["review"] is None
    assert response.json()["review_summary"]["rows"]
    page = client.get("/courses/course-a/mystra")
    assert "unreadable review/astra.yaml" in page.text
    assert "review/b1/astra.yaml" in page.text


def test_mystra_retains_source_version_location_and_quote_context(client, course_root):
    course = _extend_course(course_root)
    path = course / "astra.yaml"
    doc = yaml.safe_load(path.read_text())
    evidence = doc["analyses"]["second_analysis"]["findings"]["anchored_claim"]["evidence"][0]
    evidence.pop("artifact")
    evidence.update({"doi": "10.1234/synthetic", "version": 3, "snapshot": "snapshots/source-v3.pdf",
                     "source_commit": "abc123def", "quote": {"exact": "anchored words",
                     "prefix": "before anchor", "suffix": "after anchor"},
                     "location": {"value": "page=7", "page": 7}})
    path.write_text(yaml.safe_dump(doc))
    payload = client.get("/api/courses/course-a/mystra").json()
    analysis = next(a for a in payload["course"]["analyses"] if a["slug"] == "second_analysis")
    shown = analysis["findings"][0]["evidence"][0]
    assert shown["doi"] == "10.1234/synthetic"
    assert shown["version"] == 3 and shown["location_page"] == 7
    assert shown["quote_prefix"] == "before anchor" and shown["quote_suffix"] == "after anchor"
    page = client.get("/courses/course-a/mystra")
    for expected in ("10.1234/synthetic", "snapshots/source-v3.pdf", "abc123def", "anchored words",
                     "before anchor", "after anchor", "page=7"):
        assert expected in page.text


@pytest.mark.parametrize("fault", ["tags", "trace"])
def test_mystra_keeps_course_readable_when_nested_metadata_is_malformed(client, course_root, fault):
    course = course_root / "course-a"
    if fault == "tags":
        path = course / "astra.yaml"
        doc = yaml.safe_load(path.read_text())
        next(iter(next(iter(doc["analyses"].values()))["decisions"].values()))["tags"] = 7
        path.write_text(yaml.safe_dump(doc))
    else:
        (course / "trace" / "exploration_tree.yaml").write_text("nodes: [malformed scalar]\n")
    for url in ("/courses/course-a", "/courses/course-a/mystra", "/api/courses/course-a/mystra"):
        response = client.get(url)
        assert response.status_code == 200
        assert "Prerequisite gating strictness" in response.text
    page = client.get("/courses/course-a/mystra").text
    expected = "unreadable decision tags" if fault == "tags" else "unreadable trace/exploration_tree.yaml"
    assert expected in page
