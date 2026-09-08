"""The session-runs root, and the two store flags the CLI never exposed.

`STUDIUM_OBS_SESSIONS_ROOT` names ONE directory, read whole by
`class_report.build_report` (`Path(run_dir).rglob("telemetry.jsonl")`). It is deliberately
not course-scoped: neither writer of a telemetry stream has a course dimension — the
durable MCP-host tree is keyed by pseudonym (`<pseudonym>/<bundle_id>/telemetry.jsonl`)
and an eval run's by persona — so a `<root>/<course>` convention would invent a layout
nothing on disk produces.

It takes the same resolution INT-STUDIUM-019 gave the collector store: `Path(...).resolve()`
at read time, so the value is absolute whatever directory the service was started from.

The flags are the other half. `--analytics-data-dir` was missing from `main()`, so the
store INT-STUDIUM-019 added was reachable only by exporting the variable; both roots are
now nameable on the command line.
"""
from __future__ import annotations

import uvicorn

import observatory_app
from observatory_config import (
    ENV_ANALYTICS_DATA_DIR,
    ENV_COURSE_ROOT,
    ENV_COURSES,
    ENV_EVAL_ROOT,
    ENV_SESSIONS_ROOT,
    ENV_VALIDITY_ROOT,
    ObservatoryConfig,
)


def test_sessions_root_is_resolved_to_an_absolute_path(tmp_path, monkeypatch) -> None:
    runs = tmp_path / "runs"
    runs.mkdir()
    monkeypatch.chdir(tmp_path)
    cfg = ObservatoryConfig.from_env({ENV_SESSIONS_ROOT: "runs"})   # as an operator types it
    assert cfg.sessions_root == runs.resolve()
    assert cfg.sessions_root.is_absolute()


def test_sessions_root_is_unset_by_default() -> None:
    """An unnamed session root is not a fault: the column is simply not configured."""
    cfg = ObservatoryConfig.from_env({})
    assert cfg.sessions_root is None
    assert "sessions root missing" not in " ".join(cfg.problems())


def test_a_missing_sessions_root_is_a_problem(tmp_path) -> None:
    absent = tmp_path / "nope"
    cfg = ObservatoryConfig.from_env({ENV_SESSIONS_ROOT: str(absent)})
    named = [line for line in cfg.problems() if line.startswith("sessions root missing")]
    assert named == [f"sessions root missing: {absent}"]


def test_notes_name_the_session_root_or_say_it_is_not_configured(tmp_path) -> None:
    root = tmp_path / "session-runs"
    root.mkdir()
    configured = ObservatoryConfig.from_env({ENV_SESSIONS_ROOT: str(root)})
    assert any(str(root) in note for note in configured.notes())

    unset = ObservatoryConfig.from_env({})
    assert any(ENV_SESSIONS_ROOT in note for note in unset.notes())


def test_both_store_flags_reach_the_config(tmp_path, monkeypatch) -> None:
    """The regression for the flag that was missing: without `--analytics-data-dir` the
    collector store was reachable only through the environment."""
    for name in (ENV_COURSE_ROOT, ENV_COURSES, ENV_EVAL_ROOT, ENV_VALIDITY_ROOT,
                 ENV_ANALYTICS_DATA_DIR, ENV_SESSIONS_ROOT):
        monkeypatch.delenv(name, raising=False)
    courses = tmp_path / "courses"
    store = tmp_path / "collector-data"
    runs = tmp_path / "session-runs"
    for path in (courses, store, runs):
        path.mkdir()

    served: list[ObservatoryConfig] = []
    monkeypatch.setattr(observatory_app, "create_app", lambda cfg: cfg)
    monkeypatch.setattr(uvicorn, "run", lambda cfg, **kwargs: served.append(cfg))

    assert observatory_app.main(["--course-root", str(courses),
                                 "--analytics-data-dir", str(store),
                                 "--sessions-root", str(runs)]) == 0
    assert len(served) == 1
    assert served[0].analytics_data_dir == store.resolve()
    assert served[0].sessions_root == runs.resolve()
