#!/usr/bin/env python3
"""Bake `demo-fresh.zip`, the bundle three E2E harnesses stage and nothing created.

A.10, C.8 and M5 all point `window.__test_bundle_path` at `/tmp/studium-e2e/demo-fresh.zip`;
until this script existed, that file was never written by anything in the repository, so those
three harnesses could only ever have stopped at the library screen. (M6 stages a different
file, `demo-atomistique.zip`, from a checked-in fixture.)

The bundle is *emitted*, not stored: see `services/scene-synth/demo_fresh.py` for why, and for
the canned scene JSON that keeps the pipeline real while the language model stays out of it.

Usage:
    python tools/bake_demo_fresh.py                 # -> $BUNDLE_DIR/demo-fresh.zip
    python tools/bake_demo_fresh.py --out /tmp/x.zip
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "services" / "scene-synth"))

import demo_fresh  # noqa: E402
from scene_synth_schemas import LessonBundle  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="destination ZIP (default: $BUNDLE_DIR/demo-fresh.zip, $BUNDLE_DIR=/tmp/studium-e2e)",
    )
    args = parser.parse_args(argv)

    path = demo_fresh.bake(args.out)

    # Validated here rather than by the harness that plays it: a bundle that fails the schema
    # reaches WDIO as `[data-testid='lesson-player'] still not displayed`, which names neither
    # the file nor the field. The same check the M6 demo runs at its step 2.
    with zipfile.ZipFile(path) as zf:
        bundle = LessonBundle.model_validate(json.loads(zf.read("lesson.json")))
        entries = set(zf.namelist())
    missing = {"lesson.json", "prov.json"} - entries
    if missing:
        print(f"[bake] FAIL: {path} is missing {sorted(missing)}", file=sys.stderr)
        return 1

    types = sorted({s.type for s in bundle.scenes})
    print(
        f"[bake] {path} OK: {bundle.bundle_id} schema={bundle.schema_version} "
        f"scenes={len(bundle.scenes)} types={types}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
