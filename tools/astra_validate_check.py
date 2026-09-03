#!/usr/bin/env python
"""Build the planner's ASTRA set and the scene-review document, run the REAL validator.

INT-STUDIUM-010 reproduce script, committed so the evidence of conformance is no
longer ephemeral. Run from the repository root (CI does):

    python tools/astra_validate_check.py [--out DIR]

Prints the pinned and installed versions, the CLI output, and exits with the
CLI's return code (2 when the CLI is missing).
"""
from __future__ import annotations

import argparse
import importlib.metadata as md
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_TESTS = str(ROOT / "services" / "planner" / "tests")
if _TESTS not in sys.path:
    sys.path.insert(0, _TESTS)

from astra_course_fixture import build_course_set, build_review_set  # noqa: E402  (sets sys.path)
from provenance.astra_validate import (  # noqa: E402
    ASTRA_SPEC_PIN, ASTRA_TOOLS_PIN, run_astra_validate,
)


def _version(name: str) -> str:
    try:
        return md.version(name)
    except md.PackageNotFoundError:
        return "MISSING"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Emit the ASTRA set and run `astra validate` on it.")
    ap.add_argument("--out", type=Path, default=None,
                    help="directory for the set (default: a fresh temporary directory)")
    args = ap.parse_args(argv)
    out = args.out or Path(tempfile.mkdtemp(prefix="studium-astra-"))
    out.mkdir(parents=True, exist_ok=True)
    print(f"ASTRA set: {out}")
    print(f"astra-spec {_version('astra-spec')} (pinned {ASTRA_SPEC_PIN}) / "
          f"astra-tools {_version('astra-tools')} (pinned {ASTRA_TOOLS_PIN})")
    build_course_set(out)
    build_review_set(out)
    try:
        result = run_astra_validate(out)
    except FileNotFoundError as exc:
        print(exc)
        return 2
    print(result.output.rstrip())
    print("RESULT:", "PASS" if result.ok else f"FAIL (exit {result.returncode})")
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
