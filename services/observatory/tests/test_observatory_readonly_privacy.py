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
from conftest import (
    FREE_TEXT,
    PSEUDONYMS,
    RUN_ID,
    SMALL_COHORT_PSEUDONYMS,
    STORE_COURSE,
    STORE_PSEUDONYMS,
)
from provenance.astra_validate import AstraValidation, find_astra_cli

import observatory_validation
from observatory_config import ObservatoryConfig
from observatory_discovery import discover
from observatory_sessions import store_courses


def _urls(cfg: ObservatoryConfig) -> list[str]:
    inventory = discover(cfg)
    urls = ["/", "/api/index", "/eval/validity", "/api/eval/validity",
            # Slice 2. The session runs column has no course, so its index is crawled once.
            "/sessions", "/api/sessions",
            # Slice 3. Named session workspaces, none configured on this fixture: the pair is
            # here so "every route" stays true as routes are added, and so a future harness
            # reader that writes on GET is caught by this crawl as well as by its own suite.
            "/harness", "/api/harness"]
    for course_id in inventory.courses:
        urls += [f"/courses/{course_id}", f"/api/courses/{course_id}",
                 f"/courses/{course_id}/provenance.myst.md",
                 f"/courses/{course_id}/validation", f"/api/courses/{course_id}/validation",
                 f"/courses/{course_id}/review", f"/api/courses/{course_id}/review"]
    for run_id in inventory.runs:
        urls += [f"/eval/runs/{run_id}", f"/api/eval/runs/{run_id}"]
    # Resolved through the store's own listing, the same map the routes use.
    for course in store_courses(cfg):
        urls += [f"/sessions/{course}", f"/api/sessions/{course}"]
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
    # Both slice-2 roots are under `tmp_path`, so this snapshot already covers the collector
    # store and every telemetry stream. Asserted rather than assumed: a fixture that moved
    # either root elsewhere would silence the proof instead of failing.
    for root in (cfg.analytics_data_dir, cfg.sessions_root):
        prefix = str(root.relative_to(tmp_path))
        assert any(path.startswith(prefix) for path in before), prefix

    for url in _urls(cfg):
        assert client.get(url).status_code == 200, url

    assert _snapshot(tmp_path) == before


def test_no_pseudonym_or_free_text_in_any_response(client, cfg: ObservatoryConfig, validator) -> None:
    for url in _urls(cfg):
        text = client.get(url).text
        for secret in (*PSEUDONYMS, *FREE_TEXT, *STORE_PSEUDONYMS):
            assert secret not in text, f"{secret} leaked through {url}"


def test_a_store_pseudonym_never_reaches_the_sessions_page(client, cfg: ObservatoryConfig) -> None:
    """The store's pseudonyms are on every event BOTH columns read, and in no response.

    The crawl above proves it over every route; this proves it is not vacuous — the same
    request that hides them counts them, so the readers really did consume those events.
    """
    payload = client.get(f"/api/sessions/{STORE_COURSE}").json()
    assert payload["collector"]["n_learners"] == len(STORE_PSEUDONYMS)
    assert payload["sessions"]["n_learners"] == len(STORE_PSEUDONYMS)

    for url in (f"/sessions/{STORE_COURSE}", f"/api/sessions/{STORE_COURSE}", "/sessions",
                "/api/sessions"):
        text = client.get(url).text
        for pseudonym in STORE_PSEUDONYMS:
            assert pseudonym not in text, f"{pseudonym} leaked through {url}"


def test_a_below_floor_cohort_puts_no_number_on_the_page(client_small_cohort) -> None:
    """Below the floor the page carries the reason and not the numbers.

    The scene ids, the rates and the trust band are what the two readers would have
    returned for this store; the suppression is not a disclaimer printed above them.
    """
    response = client_small_cohort.get(f"/sessions/{STORE_COURSE}")
    assert response.status_code == 200
    text = response.text
    assert "k-anonymity floor" in text
    assert "suppressed" in text
    for forbidden in ("s1-quiz", "s2-audit", "bien", "0.5", "0.9", "0.083",
                      *SMALL_COHORT_PSEUDONYMS):
        assert forbidden not in text, forbidden


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
