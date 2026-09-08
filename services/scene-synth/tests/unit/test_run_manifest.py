"""Parity tests for RunManifest — Python mirror of RunManifestSchema (TS scenes.ts).

Mirrors packages/lesson-bundle-schema/tests/lesson-bundle.test.ts "RunManifest" block so the two
schemas can't drift: the learner-time run manifest is NON-answer-bearing, has required cmd/capsule_ref/
expected_outputs/verify_checks (+ timeout_s>0), and is OPTIONAL on a reproduction scene (back-compat).
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from scene_synth_schemas import RunManifest, ReproductionScene


_VALID = {
    "capsule_ref": "fixtures/capsule-demo",
    "cmd": ["python", "scripts/run.py"],
    "working_dir": None,
    "timeout_s": 60,
    "requirements": ["numpy", "matplotlib"],
    "expected_outputs": ["outputs/stats.csv", "figures/decay.png"],
    "verify_checks": ["file exists: outputs/stats.csv"],
    "research_question": "What is k?",
}

_REPRO_BASE = {
    "id": "s-run", "title": "Run", "type": "reproduction", "task_card_id": "tc",
    "steps": [{"step_id": "1", "instruction": "x",
               "expected_input_schema": {"type": "object"}, "expected_output": "y"}],
}


def test_valid_manifest_parses():
    m = RunManifest(**_VALID)
    assert m.cmd == ["python", "scripts/run.py"]
    assert m.expected_outputs == ["outputs/stats.csv", "figures/decay.png"]


@pytest.mark.parametrize("bad", [
    {"cmd": []},          # cmd min 1
    {"capsule_ref": ""},  # capsule_ref min 1
    {"timeout_s": 0},     # timeout_s > 0
])
def test_invalid_manifest_rejected(bad):
    with pytest.raises(ValidationError):
        RunManifest(**{**_VALID, **bad})


def test_required_fields_present():
    with pytest.raises(ValidationError):
        RunManifest(capsule_ref="x", cmd=["y"])  # missing expected_outputs + verify_checks


def test_reproduction_run_manifest_optional_and_kept():
    # optional: a reproduction scene with NO run_manifest is valid (back-compat)
    assert ReproductionScene(**_REPRO_BASE).run_manifest is None
    # kept: a run_manifest round-trips (not stripped) through dump -> re-parse
    s = ReproductionScene(**_REPRO_BASE, run_manifest=_VALID)
    d = s.model_dump(exclude_none=True)
    assert d["run_manifest"]["cmd"] == ["python", "scripts/run.py"]
    assert ReproductionScene(**d).run_manifest.capsule_ref == "fixtures/capsule-demo"
