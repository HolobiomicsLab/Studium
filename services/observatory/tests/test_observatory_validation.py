"""The validator adapter: on demand, bounded, cached by artifact tree (INT-STUDIUM-008)."""
from __future__ import annotations

import os
from pathlib import Path

import observatory_validation
import pytest
import yaml
from observatory_validation import ValidationCache, installed_versions, tree_cache_key
from provenance.astra_validate import INSTALL_HINT, AstraValidation, find_astra_cli


def _cli_or_skip() -> str:
    """Mirrors tests/test_provenance_astra_validate_cli.py: loud in CI, skipped locally."""
    cli = find_astra_cli()
    if cli:
        return cli
    if os.environ.get("CI"):
        pytest.fail(f"astra CLI missing in CI: {INSTALL_HINT}")
    pytest.skip(f"astra CLI missing (validator test skipped): {INSTALL_HINT}")


def test_run_on_emitted_course_is_ok(course_root: Path) -> None:
    _cli_or_skip()
    course = course_root / "course-a"
    view = ValidationCache(60.0).get(course, run=True)
    assert view.status == "ok", view.output
    assert view.ok is True
    assert view.returncode == 0
    assert view.versions["astra-spec"] == "0.0.14"
    assert view.versions["astra-tools"] == "0.2.17"
    assert view.ran_at
    assert view.cache_key == tree_cache_key(course)
    assert view.hint is None


def test_negative_control_reports_failed(course_root: Path) -> None:
    """course-a, not course-b: course-b carries an unparsable universe on purpose, so
    the validator would fail there for that reason instead of the injected one."""
    _cli_or_skip()
    course = course_root / "course-a"
    path = course / "astra.yaml"
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    (analysis,) = doc["analyses"].values()
    next(iter(analysis["decisions"].values()))["source_edge_id"] = "x"
    path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")

    view = ValidationCache(60.0).get(course, run=True)
    assert view.status == "failed"
    assert view.ok is False
    assert "Extra inputs" in view.output, view.output


def test_cache_hit_until_a_file_changes(course_root: Path, monkeypatch) -> None:
    calls: list[Path] = []

    def fake_run(directory, **kwargs):
        calls.append(Path(directory))
        return AstraValidation(True, 0, "All 4 file(s) passed validation.", "/fake/astra", "x")

    monkeypatch.setattr(observatory_validation, "find_astra_cli", lambda: "/fake/astra")
    monkeypatch.setattr(observatory_validation, "run_astra_validate", fake_run)

    cache = ValidationCache(60.0)
    course = course_root / "course-a"
    assert cache.get(course, run=True).status == "ok"
    assert cache.get(course, run=True).status == "ok"
    assert len(calls) == 1

    target = course / "astra.yaml"
    stamp = target.stat().st_mtime + 2
    os.utime(target, (stamp, stamp))
    assert cache.get(course, run=True).status == "ok"
    assert len(calls) == 2

    fresh = cache.get(course_root / "course-b", run=False)
    assert fresh.status == "not_run"
    assert fresh.ok is None
    assert len(calls) == 2


def test_not_installed(course_root: Path, monkeypatch) -> None:
    monkeypatch.setattr(observatory_validation, "find_astra_cli", lambda: None)
    view = ValidationCache(60.0).get(course_root / "course-a", run=True)
    assert view.status == "not_installed"
    assert view.ok is None
    assert view.hint == INSTALL_HINT


def test_timed_out(course_root: Path, monkeypatch) -> None:
    monkeypatch.setattr(observatory_validation, "find_astra_cli", lambda: "/fake/astra")
    monkeypatch.setattr(observatory_validation, "run_astra_validate",
                        lambda directory, **kw: AstraValidation(
                            False, 124, "astra validate timed out after 0.01 s",
                            "/fake/astra", str(directory), timed_out=True))
    view = ValidationCache(0.01).get(course_root / "course-a", run=True)
    assert view.status == "timed_out"
    assert view.ok is False
    assert view.returncode == 124


def test_tree_cache_key_and_versions(tmp_path: Path) -> None:
    assert tree_cache_key(tmp_path) == "0:0"
    (tmp_path / "astra.yaml").write_text("id: x\n", encoding="utf-8")
    first = tree_cache_key(tmp_path)
    assert first.startswith("1:")
    (tmp_path / "universes").mkdir()
    (tmp_path / "universes" / "u.yaml").write_text("id: u\n", encoding="utf-8")
    assert tree_cache_key(tmp_path).startswith("2:")

    versions = installed_versions()
    assert set(versions) == {"astra-spec", "astra-tools"}
