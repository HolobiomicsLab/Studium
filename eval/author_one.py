#!/usr/bin/env python3
"""author_one.py — author a single Studium bundle from a corpus id, via live claude CLI.

Used for the live-demo path (author a real course from a research article, then drive a
student session through the MCP server). Writes the bundle + author_provenance.json into
<out_dir> and prints the bundle path.

  .venv/bin/python eval/author_one.py 11 /tmp/studium_live --claude
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness.corpus import load_manifest  # noqa: E402
from harness.author import author_bundle  # noqa: E402


def main(argv: list[str]) -> int:
    corpus_id = argv[0] if argv else "11"
    out_dir = Path(argv[1]).resolve() if len(argv) > 1 else Path("/tmp/studium_live")
    mode = "claude" if "--claude" in argv else "deterministic"
    out_dir.mkdir(parents=True, exist_ok=True)

    material = next((m for m in load_manifest() if m.id == corpus_id), None)
    if material is None:
        print(f"no corpus material with id={corpus_id!r}", file=sys.stderr)
        return 2
    print(f"authoring '{material.title}' (mode={mode}) -> {out_dir}", flush=True)
    res = author_bundle(material, out_dir, mode=mode, model=None)
    print(f"BUNDLE: {res.bundle_path}")
    print(f"scene_types: {res.provenance.get('scene_types')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
