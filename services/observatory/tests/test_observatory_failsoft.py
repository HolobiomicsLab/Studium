"""Fail-soft on artifacts no emitter writes (spec constraint N3, INT-STUDIUM-008).

Every case here answered 500 during the slice-1 self-review. A document that parses
but has the wrong shape, and a text file that is not UTF-8, are gaps to name in the
page, not error pages: the index summarises every course, run and suite, so one
malformed file there takes the whole surface down.
"""
from __future__ import annotations

import json

import pytest

from conftest import RUN_ID

NOT_UTF8 = b"# written by something else \xff\xfe\n"


def test_index_and_course_survive_a_document_that_is_not_a_mapping(client, course_root):
    (course_root / "course-b" / "astra.yaml").write_text("- a\n- b\n", encoding="utf-8")

    index = client.get("/")
    assert index.status_code == 200
    assert "(unreadable astra.yaml" in index.text
    assert client.get("/api/index").status_code == 200
    assert client.get("/courses/course-b").status_code == 200
    assert client.get("/api/courses/course-b").json()["summary"]["n_analyses"] == 0
    assert client.get("/courses/course-b/provenance.myst.md").status_code == 200


def test_course_page_survives_a_universe_that_is_not_a_mapping(client, course_root):
    (course_root / "course-b" / "universes" / "listed.yaml").write_text("- a\n", encoding="utf-8")

    page = client.get("/courses/course-b")
    assert page.status_code == 200
    assert "(unreadable universes/listed.yaml" in page.text
    assert client.get("/").status_code == 200


def test_course_page_survives_list_shaped_bodies(client, course_root):
    (course_root / "course-b" / "astra.yaml").write_text(
        "astra_version: 0.0.14\nid: c\nanalyses:\n  s1:\n    - a\n"
        "  s2:\n    decisions:\n      - id: d1\n", encoding="utf-8")

    assert client.get("/").status_code == 200
    assert client.get("/courses/course-b").status_code == 200
    assert client.get("/api/courses/course-b").status_code == 200


def test_run_page_survives_a_report_that_is_not_utf8(client, eval_root):
    (eval_root / RUN_ID / "report.md").write_bytes(NOT_UTF8)

    page = client.get(f"/eval/runs/{RUN_ID}")
    assert page.status_code == 200
    assert "(unreadable report.md" in page.text
    assert client.get(f"/api/eval/runs/{RUN_ID}").json()["report_md"] is None


def test_run_and_index_survive_telemetry_that_is_not_utf8(client, eval_root):
    (eval_root / RUN_ID / "sessions" / "proficient" / "telemetry.jsonl").write_bytes(NOT_UTF8)

    assert client.get("/").status_code == 200
    page = client.get(f"/eval/runs/{RUN_ID}")
    assert page.status_code == 200
    assert "telemetry.jsonl" in page.text


def test_run_page_survives_a_finding_that_is_not_a_mapping(client, eval_root):
    audit_path = eval_root / RUN_ID / "audit.json"
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit["findings"] = ["a finding written as a string"]
    audit_path.write_text(json.dumps(audit), encoding="utf-8")

    page = client.get(f"/eval/runs/{RUN_ID}")
    assert page.status_code == 200
    assert "a finding written as a string" in page.text


def test_validity_survives_a_readme_that_is_not_utf8(client, validity_root):
    (validity_root / "suite_empty" / "README.md").write_bytes(NOT_UTF8)

    assert client.get("/").status_code == 200
    page = client.get("/eval/validity")
    assert page.status_code == 200
    assert "suite_empty" in page.text


# One entry per shape the review's adversarial crawl produced a 500 on. The value is
# written under `astra.yaml`; every page over that course must still answer.
MALFORMED = {
    "list-document": "- a\n- b\n",
    "string-document": "just a string\n",
    "analyses-as-a-string": "id: x\nanalyses: nope\n",
    "analyses-as-a-list": "id: x\nanalyses:\n  s1:\n    - a\n",
    "decisions-as-a-list": "id: x\nanalyses:\n  s1:\n    decisions:\n      - id: d1\n",
    "options-as-a-list": "id: x\nanalyses:\n  s1:\n    decisions:\n      d1:\n        options:\n          - a\n",
    "findings-as-a-list": "id: x\nanalyses:\n  s1:\n    findings:\n      - id: f1\n",
    "evidence-as-a-string": "id: x\nanalyses:\n  s1:\n    findings:\n      f1:\n        evidence: nope\n",
}


@pytest.mark.parametrize("shape", sorted(MALFORMED))
def test_every_malformed_astra_shape_still_renders(client, course_root, shape):
    (course_root / "course-b" / "astra.yaml").write_text(MALFORMED[shape], encoding="utf-8")

    for url in ("/", "/api/index", "/courses/course-b", "/api/courses/course-b",
                "/courses/course-b/provenance.myst.md"):
        assert client.get(url).status_code == 200, f"{shape} broke {url}"


def test_a_review_or_trace_of_the_wrong_shape_still_renders(client, course_root):
    (course_root / "course-a" / "review" / "astra.yaml").write_text("- a\n", encoding="utf-8")
    (course_root / "course-a" / "trace" / "exploration_tree.yaml").write_text("- a\n", encoding="utf-8")

    assert client.get("/").status_code == 200
    detail = client.get("/api/courses/course-a")
    assert detail.status_code == 200
    assert detail.json()["review"] is None
    assert "(unreadable review/astra.yaml" in client.get("/courses/course-a").text
