"""TS/Python schema-parity gate for the telemetry-event wire contract.

Builds the same {type: {field: required|optional}} summary from BOTH unions —
the Zod discriminated union (via scripts/contract_dump.ts) and the Pydantic
discriminated union — and fails on ANY asymmetry: a missing event type, a
missing field, or a required/optional mismatch. This is the gate the
discussion-scene drift (3fc830e) and the sound_total omission both lacked:
each was a field or type present on one side with CI green.

Run: .venv/bin/python -m pytest packages/telemetry-events/tests/test_contract_parity.py -q
"""
from __future__ import annotations

import json
import subprocess
import sys
import typing
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PKG_DIR.parents[1]
sys.path.insert(0, str(PKG_DIR / "python"))


def _python_contract() -> dict[str, dict[str, str]]:
    import telemetry_events
    union = typing.get_args(telemetry_events.TelemetryEvent)[0]
    summary: dict[str, dict[str, str]] = {}
    for model in typing.get_args(union):
        type_literal = typing.get_args(model.model_fields["type"].annotation)[0]
        summary[type_literal] = {
            name: "required" if field.is_required() else "optional"
            for name, field in model.model_fields.items() if name != "type"
        }
    return summary


def _typescript_contract() -> dict[str, dict[str, str]]:
    tsx = next(p for p in (
        REPO_ROOT / "node_modules/.pnpm/node_modules/.bin/tsx",
        REPO_ROOT / "node_modules/.bin/tsx",
    ) if p.exists())
    proc = subprocess.run(
        [str(tsx), str(PKG_DIR / "scripts" / "contract_dump.ts")],
        capture_output=True, text=True, timeout=120, cwd=str(REPO_ROOT),
    )
    assert proc.returncode == 0, f"contract_dump.ts failed: {proc.stderr[:800]}"
    return json.loads(proc.stdout)


def test_zod_and_pydantic_unions_declare_the_same_wire_contract():
    ts, py = _typescript_contract(), _python_contract()
    problems: list[str] = []
    for t in sorted(set(ts) - set(py)):
        problems.append(f"event type only in TypeScript: {t}")
    for t in sorted(set(py) - set(ts)):
        problems.append(f"event type only in Python: {t}")
    for t in sorted(set(ts) & set(py)):
        for f in sorted(set(ts[t]) - set(py[t])):
            problems.append(f"{t}.{f} only in TypeScript")
        for f in sorted(set(py[t]) - set(ts[t])):
            problems.append(f"{t}.{f} only in Python")
        for f in sorted(set(ts[t]) & set(py[t])):
            if ts[t][f] != py[t][f]:
                problems.append(f"{t}.{f}: {ts[t][f]} in TS vs {py[t][f]} in Python")
    assert not problems, "wire-contract drift:\n  " + "\n  ".join(problems)
