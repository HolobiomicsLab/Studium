"""INT-STUDIUM-010: the emitted ASTRA set passes the REAL validator (`astra validate`).

The proof of conformance is the external CLI (PyPI astra-tools, pinned in
requirements.txt and CI), not a test that asserts the field it wrote (the
2026-08-19 lesson). A missing CLI skips loudly outside CI and FAILS in CI.
"""
from __future__ import annotations

import os
import sys

import pytest
import yaml

from astra_course_fixture import build_course_set, build_review_set
from provenance.astra_validate import INSTALL_HINT, find_astra_cli, run_astra_validate

#: `review/b1/astra.yaml`, not `review/astra.yaml`: a review belongs to the bundle it
#: judged, and `write_review` keys it by bundle id (INT-STUDIUM-020).
_SET = ("astra.yaml", "universes/baseline.yaml", "universes/remedial.yaml",
        "review/b1/astra.yaml")


def _cli_or_skip() -> str:
    cli = find_astra_cli()
    if cli:
        return cli
    if os.environ.get("CI"):
        pytest.fail(f"astra CLI missing in CI: {INSTALL_HINT}")
    pytest.skip(f"astra CLI missing (validator test skipped): {INSTALL_HINT}")


def test_emitted_set_and_review_pass_the_real_validator(tmp_path):
    build_course_set(tmp_path)
    build_review_set(tmp_path)
    r = run_astra_validate(tmp_path, cli=_cli_or_skip())
    assert r.ok, r.output
    for rel in _SET:
        assert rel in r.output, (rel, r.output)
    assert "without a 'format'" not in r.output, r.output


def test_extension_key_is_rejected_negative_control(tmp_path):
    """Proves the schema pass still runs under --skip-evidence."""
    build_course_set(tmp_path)
    path = tmp_path / "astra.yaml"
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    (analysis,) = doc["analyses"].values()
    next(iter(analysis["decisions"].values()))["source_edge_id"] = "x"
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")
    r = run_astra_validate(tmp_path, cli=_cli_or_skip())
    assert not r.ok
    assert "Extra inputs" in r.output, r.output


def test_missing_cli_fails_loudly_in_ci(monkeypatch):
    monkeypatch.setenv("CI", "true")
    monkeypatch.setattr(sys.modules[__name__], "find_astra_cli", lambda: None)
    with pytest.raises(pytest.fail.Exception):
        _cli_or_skip()


def test_missing_cli_skips_outside_ci(monkeypatch):
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.setattr(sys.modules[__name__], "find_astra_cli", lambda: None)
    with pytest.raises(pytest.skip.Exception):
        _cli_or_skip()
