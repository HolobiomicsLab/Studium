"""The real validator is bounded — provenance.astra_validate (INT-STUDIUM-008, slice 1).

A subprocess with no timeout can hang a request for ever; the Observatory runs
`astra validate` on demand behind an HTTP GET. The timeout is reported as a verdict
(`timed_out`, return code 124), never raised, so the page still answers 200.
Addresses nit 1 of the INT-STUDIUM-010 self-review.

Run:  .venv/bin/python -m pytest services/planner/tests/test_provenance_astra_validate_timeout.py -q
"""
from __future__ import annotations

import subprocess
import types

from provenance import astra_validate
from provenance.astra_validate import AstraValidation, run_astra_validate


def _fake_ok(seen: dict):
    def fake_run(cmd, **kwargs):
        seen.update(kwargs)
        seen["cmd"] = cmd
        return types.SimpleNamespace(returncode=0, stdout="ok", stderr="")
    return fake_run


def test_timeout_is_reported_not_raised(monkeypatch, tmp_path):
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs.get("timeout"))

    monkeypatch.setattr(astra_validate.subprocess, "run", fake_run)
    result = run_astra_validate(tmp_path, cli="/fake/astra", timeout=0.01)

    assert result.timed_out is True
    assert result.ok is False
    assert result.returncode == 124
    assert "timed out" in result.output
    assert result.cwd == str(tmp_path)


def test_timeout_is_forwarded_to_subprocess(monkeypatch, tmp_path):
    seen: dict = {}
    monkeypatch.setattr(astra_validate.subprocess, "run", _fake_ok(seen))

    result = run_astra_validate(tmp_path, cli="/fake/astra", timeout=5.0)

    assert seen["timeout"] == 5.0
    assert result.ok is True
    assert result.timed_out is False


def test_default_has_no_timeout(monkeypatch, tmp_path):
    seen: dict = {}
    monkeypatch.setattr(astra_validate.subprocess, "run", _fake_ok(seen))

    run_astra_validate(tmp_path, cli="/fake/astra")

    assert seen["timeout"] is None
    assert AstraValidation(True, 0, "", "/x", "/y").timed_out is False
