"""The two intent constraints, proved by crawling every route (INT-STUDIUM-008).

R8: every route is a GET and a full crawl leaves every byte under the roots untouched.
N1: no learner pseudonym and no free-text telemetry field appears in any response.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest
from conftest import FREE_TEXT, PSEUDONYMS, RUN_ID
from provenance.astra_validate import AstraValidation, find_astra_cli

import observatory_validation
from observatory_config import ObservatoryConfig
from observatory_discovery import discover


def _urls(cfg: ObservatoryConfig) -> list[str]:
    inventory = discover(cfg)
    urls = ["/", "/api/index", "/eval/validity", "/api/eval/validity"]
    for course_id in inventory.courses:
        urls += [f"/courses/{course_id}", f"/api/courses/{course_id}",
                 f"/courses/{course_id}/provenance.myst.md",
                 f"/courses/{course_id}/validation", f"/api/courses/{course_id}/validation"]
    for run_id in inventory.runs:
        urls += [f"/eval/runs/{run_id}", f"/api/eval/runs/{run_id}"]
    return urls


def test_a_forbidden_key_in_a_validity_result_reaches_no_page(client, validity_root) -> None:
    """A validity result is written elsewhere and dropped in; the index renders it.

    `observatory_app` folds every suite into the index view, so a result file carrying a
    forbidden key would put its value on the Observatory's front page. None of the
    thirteen committed files does — the gap is that nothing stopped the next one
    (INT-STUDIUM-018).
    """
    secret = "SECRET-VALIDITY-8f2c"
    (validity_root / "suite_with_result" / "external_result.json").write_text(
        json.dumps({"n": 12, "text": secret, "learner_pseudonym": "p-1"}), encoding="utf-8")

    for url in ("/", "/api/index", "/eval/validity", "/api/eval/validity"):
        text = client.get(url).text
        assert secret not in text, f"a validity result's free text reached {url}"
        assert "p-1" not in text, f"a validity result's pseudonym reached {url}"
    # The result is still shown; only the forbidden keys are gone.
    assert "external_result.json" in client.get("/eval/validity").text


def _snapshot(root: Path) -> dict[str, tuple[int, str]]:
    return {
        str(path.relative_to(root)): (
            path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(root.rglob("*")) if path.is_file()
    }


@pytest.fixture
def validator(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real CLI when it is installed — the stronger proof that the subprocess writes
    nothing under the course — and an offline stand-in when it is not."""
    if find_astra_cli() is None:
        monkeypatch.setattr(observatory_validation, "find_astra_cli", lambda: "/fake/astra")
        monkeypatch.setattr(
            observatory_validation, "run_astra_validate",
            lambda *a, **k: AstraValidation(True, 0, "All 4 file(s) passed validation.", "/fake/astra", "x"))


def test_every_route_is_get_only(client) -> None:
    for route in client.app.routes:
        methods = getattr(route, "methods", None)
        if methods:
            assert set(methods) <= {"GET", "HEAD"}, route.path


def test_crawl_changes_no_file(client, cfg: ObservatoryConfig, tmp_path: Path, validator) -> None:
    before = _snapshot(tmp_path)
    assert before, "the fixtures wrote nothing to crawl"

    for url in _urls(cfg):
        assert client.get(url).status_code == 200, url

    assert _snapshot(tmp_path) == before


def test_no_pseudonym_or_free_text_in_any_response(client, cfg: ObservatoryConfig, validator) -> None:
    for url in _urls(cfg):
        text = client.get(url).text
        for secret in (*PSEUDONYMS, *FREE_TEXT):
            assert secret not in text, f"{secret} leaked through {url}"


def test_unreadable_audit_renders_marker(client, eval_root: Path) -> None:
    (eval_root / RUN_ID / "audit.json").write_text("{", encoding="utf-8")

    page = client.get(f"/eval/runs/{RUN_ID}")
    assert page.status_code == 200
    assert "(unreadable audit.json" in page.text
    assert client.get("/").status_code == 200


def test_reader_faults_disclose_neither_artifact_text_nor_errno(
    client, cfg: ObservatoryConfig, course_root: Path, eval_root: Path, validator
) -> None:
    """A reader fault must not turn an unreadable artifact into a disclosure.

    The fixture's own broken file (`id: [unclosed`) carries nothing worth leaking, so
    the crawl above passes with this hole open. These two artifacts carry something:
    a YAML parse error quotes the source line, and an OSError names the path it failed
    on. Course and run paths are printed by design, so the assertion is on the two
    things that are never a chosen field — the artifact's own text, and errno prose.
    """
    secret = "SECRET-COURSE-CONTENT-8e21"
    (course_root / "course-a" / "universes" / "leaky.yaml").write_text(
        f"id: leaky\nnote: [{secret}\n", encoding="utf-8")
    report = eval_root / RUN_ID / "report.md"
    report.chmod(0o000)  # a read now raises PermissionError, which names the path
    if os.access(report, os.R_OK):  # running as root: the errno half cannot be staged
        pytest.skip("cannot make a file unreadable as this user")

    for url in _urls(cfg):
        text = client.get(url).text
        assert secret not in text, f"artifact text leaked through {url}"
        assert "[Errno" not in text, f"errno detail leaked through {url}"

    # The marker still names the file and its fault class, which is what the
    # operator acts on; only the errno prose and the path are gone.
    page = client.get(f"/eval/runs/{RUN_ID}").text
    assert "(unreadable report.md: PermissionError)" in page
    report.chmod(0o644)
