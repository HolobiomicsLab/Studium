"""Configuration and directory-convention discovery (INT-STUDIUM-008, slice 1)."""
from __future__ import annotations

import dataclasses
import os
from pathlib import Path

import pytest

from observatory_config import (
    DEFAULT_COURSE_ROOTS,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DEFAULT_VALIDATOR_TIMEOUT,
    ObservatoryConfig,
)
from observatory_discovery import discover, parse_run_dirname
from observatory_paths import EVAL_DIR


def test_from_env_reads_every_variable(tmp_path: Path) -> None:
    env = {
        "STUDIUM_LWG_OUT_DIR": str(tmp_path / "courses"),
        "STUDIUM_OBS_COURSES": os.pathsep.join([str(tmp_path / "c1"), str(tmp_path / "c2")]),
        "STUDIUM_OBS_EVAL_ROOT": str(tmp_path / "reports"),
        "STUDIUM_OBS_VALIDITY_ROOT": str(tmp_path / "validity"),
        "STUDIUM_OBS_HOST": "0.0.0.0",
        "STUDIUM_OBS_PORT": "9001",
        "STUDIUM_OBS_VALIDATOR_TIMEOUT": "12.5",
    }
    cfg = ObservatoryConfig.from_env(env)
    assert cfg.course_root == (tmp_path / "courses").resolve()
    assert cfg.courses == ((tmp_path / "c1").resolve(), (tmp_path / "c2").resolve())
    assert cfg.eval_root == (tmp_path / "reports").resolve()
    assert cfg.validity_root == (tmp_path / "validity").resolve()
    assert cfg.host == "0.0.0.0"
    assert cfg.port == 9001
    assert cfg.validator_timeout == 12.5
    assert cfg.raw_problems == ()

    from harness.paths import REPORTS_DIR

    empty = ObservatoryConfig.from_env({})
    assert empty.course_root in DEFAULT_COURSE_ROOTS
    assert empty.courses == ()
    assert empty.eval_root == REPORTS_DIR
    assert empty.validity_root == EVAL_DIR / "validity"
    assert empty.host == DEFAULT_HOST
    assert empty.port == DEFAULT_PORT
    assert empty.validator_timeout == DEFAULT_VALIDATOR_TIMEOUT

    bad = ObservatoryConfig.from_env({"STUDIUM_OBS_PORT": "abc"})
    assert bad.port == DEFAULT_PORT
    assert any("invalid port" in p for p in bad.raw_problems)
    assert any("invalid port" in p for p in bad.problems())


def test_problems_name_missing_roots(tmp_path: Path) -> None:
    missing = ObservatoryConfig(course_root=tmp_path / "nope", courses=(),
                                eval_root=tmp_path / "nope-eval",
                                validity_root=tmp_path / "nope-validity")
    lines = missing.problems()
    assert len(lines) == 3
    assert any(line.startswith("course root missing:") for line in lines)
    assert any(line.startswith("eval root missing:") for line in lines)
    assert any(line.startswith("validity root missing:") for line in lines)

    present = tmp_path / "explicit-course"
    present.mkdir()
    explicit = ObservatoryConfig(course_root=tmp_path / "nope", courses=(present, tmp_path / "gone"),
                                 eval_root=tmp_path / "nope-eval",
                                 validity_root=tmp_path / "nope-validity")
    lines = explicit.problems()
    assert not any(line.startswith("course root missing:") for line in lines)
    assert [line for line in lines if line.startswith("explicit course missing:")] == [
        f"explicit course missing: {tmp_path / 'gone'}"]


def test_discover_finds_courses_runs_and_suites(cfg) -> None:
    inv = discover(cfg)
    assert set(inv.courses) == {"course-a", "course-b"}
    assert inv.courses["course-a"].source == "root"
    assert list(inv.runs) == ["01-deterministic-20260615-120000"]
    assert set(inv.suites) == {"suite_with_result", "suite_empty"}
    assert inv.problems == ()


def test_discover_ignores_non_courses_and_dedups_ids(tmp_path: Path, cfg) -> None:
    (cfg.course_root / "not-a-course").mkdir()
    twin = tmp_path / "elsewhere" / "course-a"
    twin.mkdir(parents=True)
    (twin / "astra.yaml").write_text("astra_version: 0.0.14\nid: twin\n", encoding="utf-8")

    inv = discover(dataclasses.replace(cfg, courses=(twin,)))
    assert "not-a-course" not in inv.courses
    assert set(inv.courses) == {"course-a", "course-b", "course-a~2"}
    assert inv.courses["course-a~2"].path == twin
    assert inv.courses["course-a~2"].source == "explicit"
    assert any("course-a" in p for p in inv.problems)


@pytest.mark.parametrize(
    "name, expected",
    [
        ("01-claude-20260615-151816", ("01", "claude", "20260615-151816")),
        ("smoke-m3-20260615-120000", ("smoke", "m3", "20260615-120000")),
        ("random", (None, None, None)),
    ],
)
def test_parse_run_dirname(name: str, expected: tuple) -> None:
    parsed = parse_run_dirname(name)
    assert (parsed["corpus_id"], parsed["author_mode"], parsed["timestamp"]) == expected


@pytest.mark.parametrize(
    ("raw_port", "raw_timeout", "word"),
    [
        ("70000", "60", "port"),
        ("0", "60", "port"),
        ("-1", "60", "port"),
        ("8004", "nan", "timeout"),
        ("8004", "inf", "timeout"),
        ("8004", "0", "timeout"),
        ("8004", "-5", "timeout"),
    ],
)
def test_out_of_range_port_and_timeout_keep_the_default(
    raw_port: str, raw_timeout: str, word: str
) -> None:
    """A value that parses but cannot be served or waited on is a problem, not a setting.

    `nan` is the one that matters: `subprocess.run(timeout=nan)` never elapses, so the
    bound Task 2 put on the validator would be silently gone.
    """
    cfg = ObservatoryConfig.from_env(
        {"STUDIUM_OBS_PORT": raw_port, "STUDIUM_OBS_VALIDATOR_TIMEOUT": raw_timeout}
    )
    assert cfg.port == DEFAULT_PORT
    assert cfg.validator_timeout == DEFAULT_VALIDATOR_TIMEOUT
    assert len(cfg.raw_problems) == 1
    assert word in cfg.raw_problems[0]
