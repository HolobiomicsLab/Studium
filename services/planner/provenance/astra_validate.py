"""Run the REAL ASTRA validator (`astra validate`, PyPI `astra-tools`) on a directory.

INT-STUDIUM-010 (2026-09-03). The CLI is not part of `astra-spec` (data model
only); it ships as `astra-tools`. With no FILE argument, `astra validate`
discovers every root `astra.yaml` and every `universes/*.yaml` under the cwd
(so `review/astra.yaml` too) and runs the universe semantics
(`[MISSING_DECISION]`): the only form that covers the whole emitted set.
`--skip-evidence` keeps it offline (no DOI / artifact resolution); the schema
pass still runs (proven by the negative control in
tests/test_provenance_astra_validate_cli.py).

The vendored contract (astra_contract.py) stays the offline fallback for the id
grammar; this module is the proof of conformance.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ASTRA_SPEC_PIN = "0.0.14"
ASTRA_TOOLS_PIN = "0.2.17"
INSTALL_HINT = (
    "uv pip install --python .venv/bin/python "
    f"astra-spec=={ASTRA_SPEC_PIN} astra-tools=={ASTRA_TOOLS_PIN}"
)


@dataclass(frozen=True)
class AstraValidation:
    ok: bool
    returncode: int
    output: str  # stdout then stderr, colour-free
    cli: str
    cwd: str


def find_astra_cli() -> str | None:
    """The `astra` executable next to the running interpreter (the project venv),
    else the first one on PATH; None when absent."""
    candidate = Path(sys.executable).with_name("astra")
    if candidate.is_file():
        return str(candidate)
    return shutil.which("astra")


def run_astra_validate(directory: str | os.PathLike[str], *, cli: str | None = None,
                       skip_evidence: bool = True) -> AstraValidation:
    """`astra validate [--skip-evidence]` with `directory` as cwd. Raises
    FileNotFoundError (with the install hint) when no CLI can be found."""
    cli = cli or find_astra_cli()
    if cli is None:
        raise FileNotFoundError(f"astra CLI not found; {INSTALL_HINT}")
    cmd = [cli, "validate"] + (["--skip-evidence"] if skip_evidence else [])
    env = {**os.environ, "NO_COLOR": "1", "TERM": "dumb", "COLUMNS": "200"}
    proc = subprocess.run(cmd, cwd=str(directory), env=env, capture_output=True, text=True)
    output = proc.stdout + (f"\n{proc.stderr}" if proc.stderr else "")
    return AstraValidation(ok=proc.returncode == 0, returncode=proc.returncode,
                           output=output, cli=cli, cwd=str(directory))
