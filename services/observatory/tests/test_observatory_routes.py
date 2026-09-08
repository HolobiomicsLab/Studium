"""Every slice-1 route, driven through Starlette's TestClient (INT-STUDIUM-008)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from conftest import RUN_ID
from provenance.astra_read import load_course
from provenance.astra_validate import AstraValidation

import observatory_validation
from astra_render import render


def _fake_ok(*args, **kwargs) -> AstraValidation:
    return AstraValidation(True, 0, "All 4 file(s) passed validation.", "/fake/astra", "x")


@pytest.fixture
def fake_validator(monkeypatch: pytest.MonkeyPatch) -> None:
    """The route tests must not depend on the astra CLI being installed."""
    monkeypatch.setattr(observatory_validation, "find_astra_cli", lambda: "/fake/astra")
    monkeypatch.setattr(observatory_validation, "run_astra_validate", _fake_ok)


def test_index_lists_everything(client) -> None:
    page = client.get("/")
    assert page.status_code == 200
    for expected in ("course-a", "course-b", RUN_ID, "suite_with_result"):
        assert expected in page.text

    index = client.get("/api/index").json()
    assert len(index["courses"]) == 2
    assert len(index["runs"]) == 1
    assert len(index["suites"]) == 2
    assert index["problems"] == []


def test_course_page_shows_every_decision_universe_and_evidence(client, course_root: Path) -> None:
    page = client.get("/courses/course-a")
    assert page.status_code == 200

    docs = load_course(course_root / "course-a")
    for analysis in docs.astra["analyses"].values():
        for decision_id in analysis.get("decisions") or {}:
            assert decision_id in page.text
        for finding_id, finding in (analysis.get("findings") or {}).items():
            assert finding_id in page.text
            for item in finding.get("evidence") or []:  # a list of {id, artifact, ...}
                assert item["id"] in page.text

    assert "baseline" in page.text and "remedial" in page.text
    assert "N01" in page.text
    assert "Review" in page.text

    degraded = client.get("/courses/course-b")
    assert degraded.status_code == 200
    assert "(unreadable universes/broken.yaml" in degraded.text


def test_myst_route_is_markdown_and_equal_to_render(client, course_root: Path) -> None:
    page = client.get("/courses/course-a/provenance.myst.md")
    assert page.status_code == 200
    assert page.headers["content-type"].startswith("text/markdown")
    assert page.text == render(course_root / "course-a")


def test_validation_routes(client, fake_validator) -> None:
    api = client.get("/api/courses/course-a/validation").json()
    assert api["status"] == "ok"
    assert api["ok"] is True

    page = client.get("/courses/course-a/validation")
    assert page.status_code == 200
    assert "ok" in page.text

    assert "ok" in client.get("/courses/course-a").text
    assert client.get("/api/courses/nope/validation").status_code == 404


def test_run_page(client, eval_root: Path) -> None:
    audit = json.loads((eval_root / RUN_ID / "audit.json").read_text(encoding="utf-8"))
    page = client.get(f"/eval/runs/{RUN_ID}")
    assert page.status_code == 200
    for dimension in audit["dimension_scores"]:
        assert dimension in page.text
    assert "proficient" in page.text and "struggling" in page.text
    assert "synthetic persona" in page.text
    assert page.text.count('class="cap"') == 1

    detail = client.get(f"/api/eval/runs/{RUN_ID}").json()
    assert [p["name"] for p in detail["personas"]] == ["proficient", "struggling"]
    assert detail["personas"][1]["cap_hit"] is True


def test_validity_page(client) -> None:
    page = client.get("/eval/validity")
    assert page.status_code == 200
    assert "EV-1 — Suite with result" in page.text
    assert "EV-2 — Suite without result" in page.text
    assert "no result file" in page.text
    assert "0.71" in page.text

    assert len(client.get("/api/eval/validity").json()["suites"]) == 2


def test_unknown_ids_are_404(client) -> None:
    for url in ("/courses/nope", "/api/courses/nope", "/courses/nope/provenance.myst.md",
                "/eval/runs/nope", "/api/eval/runs/nope"):
        assert client.get(url).status_code == 404, url


def test_a_course_id_needing_escapes_still_links(client, course_root: Path) -> None:
    """Review nit 3: ids reach hrefs, and a directory name is not a URL.

    Autoescaping stops injection, so this is not a hole -- it is a dead link. A `#` in a
    course directory name truncates the href at the fragment and the operator gets a 404
    on a course the same page just listed.
    """
    import shutil
    from urllib.parse import quote

    awkward = "course #1 draft"
    shutil.copytree(course_root / "course-a", course_root / awkward)

    listing = client.get("/")
    assert listing.status_code == 200
    assert f'href="/courses/{awkward}"' not in listing.text
    assert f'href="/courses/{quote(awkward)}"' in listing.text

    page = client.get(f"/courses/{quote(awkward)}")
    assert page.status_code == 200
    assert awkward in page.text
