#!/usr/bin/env python3
"""Reproduce the captured-paper → draft → MySTRA → external viewer demonstration.

Usage: python tools/demo-literature-experience.py NEW_OUTPUT_DIR
Requires pnpm install/build and Chrome. No remote fetch or model call. Executes only
the repository's known synthetic-spectrum fixture, copied into the new output dir.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from experience_packet import prepare_packet, check_response
from experience_review import write_experience_provenance

ROOT = Path(__file__).resolve().parents[1]


def _run_fixture(output: Path) -> Path:
    capsule = output / "capsule"
    capsule.mkdir()
    for name in ("run.py", "spectra.json"):
        shutil.copy2(ROOT / "fixtures/metabo-judgment-demo" / name, capsule / name)
    result = subprocess.run([sys.executable, "run.py"], cwd=capsule,
                            capture_output=True, text=True, timeout=30)
    record = {"command": [sys.executable, "run.py"], "exit_code": result.returncode,
              "stdout": result.stdout, "stderr": result.stderr,
              "script_sha256": hashlib.sha256((capsule / "run.py").read_bytes()).hexdigest(),
              "data_status": "synthetic illustrative spectra; real calculation, not paper reproduction"}
    (output / "execution.json").write_text(json.dumps(record, indent=2) + "\n")
    result.check_returncode()
    return capsule


def run_demo(output: Path) -> Path:
    """Create a new isolated demonstration with an actual run and browser evidence."""
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    example = ROOT / "examples/literature-experience"
    packet = prepare_packet(passages_path=example / "passages.json", output_dir=output / "packet",
                            title="What does a spectral similarity score establish?", target="Graduate scientists")
    review = check_response(packet_dir=packet, response_path=example / "author-response.json",
                            output_dir=output / "courses" / "spectral-evidence")
    write_experience_provenance(review)
    capsule = _run_fixture(output)
    result = subprocess.run([str(ROOT / "apps/lesson-mcp/node_modules/.bin/tsx"),
                             "tools/audit-experience-ui.mjs", str(capsule), str(output / "audit"), str(review)],
                            cwd=ROOT, capture_output=True, text=True, timeout=120)
    (output / "browser.log").write_text(result.stdout + result.stderr)
    result.check_returncode()
    return output


def main() -> int:
    """Run the local demonstration and report its review/viewer output directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        print(run_demo(args.output))
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"experience demonstration: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
