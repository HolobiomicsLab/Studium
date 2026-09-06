"""The analytics store the Observatory reads, and the k floor it will apply to it.

INT-STUDIUM-019: the collector's own `ANALYTICS_DATA_DIR` defaults to the *relative*
`"data"`, and the teacher guide starts the collector after a `cd`, so the same string
means two directories depending on where each process was started. The Observatory takes
its own variable, resolves it to an absolute path, and echoes it on the index — a cwd
divergence has to be visible, not silent. The floor's value is `class_report`'s constant;
there is no second literal and no course token (the collector's token *is* the course id).
"""
from __future__ import annotations

import dataclasses

from fastapi.testclient import TestClient

from class_report import MIN_LEARNERS_DEFAULT
from observatory_app import create_app
from observatory_config import ENV_ANALYTICS_DATA_DIR, ObservatoryConfig


def test_analytics_data_dir_is_resolved_to_an_absolute_path(tmp_path, monkeypatch):
    store = tmp_path / "data"
    store.mkdir()
    monkeypatch.chdir(tmp_path)
    cfg = ObservatoryConfig.from_env({ENV_ANALYTICS_DATA_DIR: "data"})   # the relative default
    assert cfg.analytics_data_dir == store.resolve()
    assert cfg.analytics_data_dir.is_absolute()
    assert cfg.problems() == [] or "analytics" not in " ".join(cfg.problems())


def test_analytics_data_dir_is_unset_by_default():
    cfg = ObservatoryConfig.from_env({})
    assert cfg.analytics_data_dir is None


def test_a_missing_analytics_dir_is_a_problem(tmp_path):
    absent = tmp_path / "nope"
    cfg = ObservatoryConfig.from_env({ENV_ANALYTICS_DATA_DIR: str(absent)})
    assert f"analytics store missing: {absent}" in cfg.problems()


def test_notes_echo_the_resolved_store_or_say_it_is_not_configured(tmp_path):
    store = tmp_path / "collector-data"
    store.mkdir()
    configured = ObservatoryConfig.from_env({ENV_ANALYTICS_DATA_DIR: str(store)})
    assert any(str(store) in note for note in configured.notes())

    unset = ObservatoryConfig.from_env({})
    joined = " ".join(unset.notes())
    assert ENV_ANALYTICS_DATA_DIR in joined
    # and it names the trap it exists to make visible
    assert "ANALYTICS_DATA_DIR" in joined


def test_the_floor_is_class_reports_constant_not_a_second_literal():
    cfg = ObservatoryConfig.from_env({})
    assert cfg.min_learners == MIN_LEARNERS_DEFAULT


def test_no_course_token_variable_is_read():
    """The collector's check is string equality between the `X-Course-Token` header and the
    `course` query parameter: the token *is* the course id, typed into the teacher dashboard
    and rendered on screen. A variable documented as a secret would protect nothing."""
    env_names = {v for k, v in vars(__import__("observatory_config")).items()
                 if k.startswith("ENV_") and isinstance(v, str)}
    assert not any("TOKEN" in name for name in env_names)


def test_the_index_shows_the_store_it_would_read(cfg, tmp_path):
    store = tmp_path / "collector-data"
    store.mkdir()
    with_store = dataclasses.replace(cfg, analytics_data_dir=store.resolve())
    with TestClient(create_app(with_store)) as client:
        payload = client.get("/api/index").json()
        assert any(str(store) in note for note in payload["notes"])
        assert str(store) in client.get("/").text

    with TestClient(create_app(cfg)) as client:
        payload = client.get("/api/index").json()
        assert any(ENV_ANALYTICS_DATA_DIR in note for note in payload["notes"])
