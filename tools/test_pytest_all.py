"""Tests for tools/pytest_all.py — the one declared command that runs every Python test.

INT-STUDIUM-011. Two facts motivated it, both still true when this file was written:

  * the command declared in CLAUDE.md, `pytest services/ packages/lesson-plan-schema/tests_python/`,
    aborts at collection with exit 2 — `services/analytics-collector/tests/conftest.py` and
    `services/scene-synth/tests/conftest.py` both import as `tests.conftest`;
  * CI runs a bare `pytest`, which `pytest.ini` (`testpaths = packages`) limits to `packages/`,
    so roughly a thousand tests under `services/`, `eval/`, `tools/` and `fixtures/` were green
    only when someone ran them by hand.

The owner answered the intent's open question with the wrapper form: one pytest process per suite,
no import-mode change. So the wrapper's job is exactly two things, and this file pins both:

  1. suites that would collide in one process each run in their own process (`test_two_services_...`);
  2. a suite nobody listed still runs — discovery is a rule, not a hand-written list, and a test
     file no rule reaches is REPORTED rather than skipped in silence (`test_a_test_file_no_suite_...`).

(2) is the one that matters over time. A wrapper with a hand-written list reproduces the defect it
was written to fix the first time someone adds a directory.

Run: .venv/bin/python -m pytest tools/test_pytest_all.py -q
"""
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pytest_all  # noqa: E402

PASSING = "def test_ok():\n    assert True\n"
FAILING = "def test_no():\n    assert False\n"
# The real collision: two `tests/` packages whose conftest both import as `tests.conftest`.
CONFTEST = "import pytest\n\n\n@pytest.fixture\ndef unused():\n    return 1\n"


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _run_wrapper(root: Path):
    """Run the wrapper as the CI step runs it: a process, on a tree, from that tree."""
    return subprocess.run(
        [sys.executable, str(Path(pytest_all.__file__)), "--root", str(root)],
        capture_output=True, text=True, cwd=str(root), timeout=300,
    )


def _rel(root: Path, suites):
    return sorted(str(s.relative_to(root)) for s in suites)


# ---------------------------------------------------------------------------
# discovery — the rule, not a list
# ---------------------------------------------------------------------------

def test_a_new_service_directory_is_a_suite_with_no_edit_to_the_wrapper(tmp_path):
    """`services/` holds no test file of its own, so each service is its own suite. Adding a
    sixth service must not require remembering to add a line here or in CI."""
    _write(tmp_path / "services" / "alpha" / "tests" / "test_a.py", PASSING)
    _write(tmp_path / "services" / "beta" / "tests" / "test_b.py", PASSING)
    _write(tmp_path / "services" / "gamma" / "README.md", "no tests here")

    assert _rel(tmp_path, pytest_all.discover_suites(tmp_path)) == ["services/alpha", "services/beta"]


def test_a_directory_holding_its_own_tests_is_one_suite(tmp_path):
    """`tools/` keeps its test files beside the modules they test; splitting it per child would
    orphan them. A directory that tests itself is the suite."""
    _write(tmp_path / "tools" / "test_x.py", PASSING)
    _write(tmp_path / "tools" / "helpers" / "test_y.py", PASSING)

    assert _rel(tmp_path, pytest_all.discover_suites(tmp_path)) == ["tools"]


def test_generated_and_vendored_trees_are_not_suites(tmp_path):
    """`node_modules` carries thousands of files matching `test_*.py` in the wrong language's
    fixtures; a wrapper that walks into it reports failures nobody owns."""
    _write(tmp_path / "packages" / "thing" / "test_real.py", PASSING)
    _write(tmp_path / "node_modules" / "pkg" / "test_vendored.py", FAILING)
    _write(tmp_path / ".venv" / "lib" / "test_installed.py", FAILING)

    assert _rel(tmp_path, pytest_all.discover_suites(tmp_path)) == ["packages/thing"]


# ---------------------------------------------------------------------------
# the defect the wrapper exists for
# ---------------------------------------------------------------------------

def test_two_services_with_colliding_conftests_both_run(tmp_path):
    """The intent's first fact, reproduced and then fixed in one test.

    One pytest process over both services aborts at collection — that is the defect, asserted
    here so the wrapper's reason for existing cannot quietly evaporate. The wrapper runs the
    same tree green, because each service is its own process.
    """
    for svc in ("analytics", "synth"):
        _write(tmp_path / "services" / svc / "tests" / "__init__.py", "")
        _write(tmp_path / "services" / svc / "tests" / "conftest.py", CONFTEST)
        _write(tmp_path / "services" / svc / "tests" / "test_it.py", PASSING)

    one_process = subprocess.run(
        [sys.executable, "-m", "pytest", "services", "-q"],
        capture_output=True, text=True, cwd=str(tmp_path), timeout=300,
    )
    assert one_process.returncode != 0, "the collision this wrapper exists for is gone; re-cut the intent"
    assert "ImportPathMismatchError" in one_process.stdout + one_process.stderr

    wrapped = _run_wrapper(tmp_path)
    assert wrapped.returncode == 0, wrapped.stdout + wrapped.stderr
    assert "services/analytics" in wrapped.stdout and "services/synth" in wrapped.stdout


def test_a_test_file_no_suite_reaches_fails_the_run_by_name(tmp_path):
    """The failure mode the wrapper must not reintroduce: a test that runs nowhere.

    A hand-written suite list degrades into exactly the state this intent describes. Discovery
    covers every test file by construction, so the guard fires only when the exclusion rules are
    wrong — and then it says which file, instead of reporting a green run over fewer tests.
    """
    _write(tmp_path / "services" / "alpha" / "tests" / "test_a.py", PASSING)
    orphan = _write(tmp_path / "test_at_the_root.py", PASSING)

    assert pytest_all.uncovered_tests(tmp_path, pytest_all.discover_suites(tmp_path)) == [orphan]

    r = _run_wrapper(tmp_path)
    assert r.returncode != 0
    assert "test_at_the_root.py" in r.stdout


# ---------------------------------------------------------------------------
# aggregation — one command, one exit code
# ---------------------------------------------------------------------------

def test_a_failing_suite_fails_the_command_and_the_other_suites_still_ran(tmp_path):
    """Per-suite isolation must not become stop-on-first-failure: a developer running this once
    should see every broken suite, not rediscover them one run at a time."""
    _write(tmp_path / "services" / "alpha" / "tests" / "test_a.py", FAILING)
    _write(tmp_path / "services" / "beta" / "tests" / "test_b.py", PASSING)
    _write(tmp_path / "services" / "delta" / "tests" / "test_d.py", FAILING)

    r = _run_wrapper(tmp_path)
    assert r.returncode != 0
    assert "services/beta" in r.stdout, "a later suite was skipped after an earlier failure"
    # both failures are named in the summary, not just the first
    tail = r.stdout[r.stdout.index("services/delta"):]
    assert "FAIL" in tail
    assert r.stdout.count("FAIL") >= 2


def test_the_command_is_green_and_says_so_when_every_suite_passes(tmp_path):
    """The success marker CLAUDE.md declares: exit 0 and a line a reader can check against."""
    _write(tmp_path / "services" / "alpha" / "tests" / "test_a.py", PASSING)
    _write(tmp_path / "tools" / "test_t.py", PASSING)

    r = _run_wrapper(tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "2 suites" in r.stdout
    assert "0 failing" in r.stdout
