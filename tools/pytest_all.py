#!/usr/bin/env python3
"""Run every Python test in the repository — one pytest process per suite (INT-STUDIUM-011).

    python tools/pytest_all.py            # the declared command
    python tools/pytest_all.py -- -x -q   # extra arguments go to each pytest process

WHY A WRAPPER AND NOT ONE PYTEST. `services/analytics-collector/tests/conftest.py` and
`services/scene-synth/tests/conftest.py` both import as `tests.conftest`, so a single process over
both aborts at collection (`ImportPathMismatchError`) before any test runs. The product owner
answered INT-STUDIUM-011's open question with this form: the wrapper first, the single-process form
later if the conftests are ever renamed. No import mode changes, no test tree is edited, and each
suite keeps the `sys.path` its modules already rely on — `eval/tests/test_scene_judge_astra_fields.py`
imports a sibling test module by name, and `tools/astra_validate_check.py` imports a planner test
fixture by name.

WHY DISCOVERY AND NOT A LIST. The defect this command fixes is that ~1000 tests ran only by hand:
`pytest.ini` sets `testpaths = packages`, so CI's bare `pytest` saw 112 of them and everything under
`services/`, `eval/`, `tools/` and `fixtures/` was invisible. A wrapper carrying a hand-written list
of suites reproduces that defect the first time somebody adds a directory and forgets the list. So
suites are derived by a rule:

    a top-level directory that holds test files DIRECTLY is one suite (`tools/`);
    otherwise each of its immediate children holding tests at any depth is a suite (`services/*`).

and `uncovered_tests` then asserts the rule reached every test file in the tree. That guard is what
turns "a suite ran nowhere" from a silently smaller green run into a named failure.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# pytest's own default `python_files`. Kept in sync deliberately: a file this wrapper does not
# recognise as a test is a file pytest would collect and the coverage guard would not defend.
TEST_GLOBS = ("test_*.py", "*_test.py")

# Trees that are installed or generated rather than written here. `node_modules` alone carries
# hundreds of files matching `test_*.py` inside vendored fixtures.
SKIP_DIRS = {"node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", "site-packages"}


def _skip(d: Path) -> bool:
    return d.name in SKIP_DIRS or d.name.startswith(".")


def _is_test_file(p: Path) -> bool:
    return p.is_file() and any(p.match(g) for g in TEST_GLOBS)


def test_files(directory: Path) -> list[Path]:
    """Every test file at any depth under `directory`, skipping installed/generated trees."""
    found: list[Path] = []
    for child in sorted(directory.iterdir()):
        if child.is_dir():
            if not _skip(child):
                found.extend(test_files(child))
        elif _is_test_file(child):
            found.append(child)
    return found


def discover_suites(root: Path) -> list[Path]:
    """The isolation units, in a stable order. See the module docstring for the rule."""
    suites: list[Path] = []
    for top in sorted(root.iterdir()):
        if not top.is_dir() or _skip(top) or not test_files(top):
            continue
        if any(_is_test_file(p) for p in top.iterdir()):
            suites.append(top)          # the directory tests itself, e.g. tools/
            continue
        for child in sorted(top.iterdir()):
            if child.is_dir() and not _skip(child) and test_files(child):
                suites.append(child)    # e.g. services/planner
    return suites


def uncovered_tests(root: Path, suites: list[Path]) -> list[Path]:
    """Test files no suite reaches. Empty by construction — unless SKIP_DIRS is wrong, or a test
    file sits at the repository root where no rule looks."""
    return [f for f in test_files(root) if not any(s == f or s in f.parents for s in suites)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="repository root (default: the current directory)")
    ap.add_argument("pytest_args", nargs="*", help="arguments forwarded to every pytest process")
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    suites = discover_suites(root)
    orphans = uncovered_tests(root, suites)

    results: list[tuple[str, int, str]] = []
    for suite in suites:
        name = str(suite.relative_to(root))
        print(f"\n=== {name} " + "=" * max(0, 60 - len(name)), flush=True)
        proc = subprocess.run(
            [sys.executable, "-m", "pytest", str(suite), "-q", *args.pytest_args],
            capture_output=True, text=True, cwd=str(root),
        )
        print(proc.stdout, end="", flush=True)
        if proc.stderr:
            print(proc.stderr, end="", file=sys.stderr, flush=True)
        last = next((ln for ln in reversed(proc.stdout.splitlines()) if ln.strip()), "")
        results.append((name, proc.returncode, last.strip()))

    failing = [r for r in results if r[1] != 0]
    print("\n" + "=" * 70)
    for name, code, last in results:
        print(f"{'FAIL' if code else '  ok'}  {name:<38} exit={code} | {last[:70]}")
    for f in orphans:
        print(f"FAIL  {f.relative_to(root)}: no suite reaches this test file")
    print(f"\n{len(results)} suites, {len(failing)} failing"
          + (f", {len(orphans)} test files uncovered" if orphans else ""))
    return 1 if failing or orphans else 0


if __name__ == "__main__":
    raise SystemExit(main())
