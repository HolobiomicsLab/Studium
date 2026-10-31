import sys, os
_dir = os.path.dirname(__file__)
if _dir not in sys.path:
    sys.path.insert(0, _dir)

import pytest


@pytest.fixture(autouse=True)
def explicit_planner_mock(monkeypatch):
    """The end-to-end tests drive the planner pipeline with its deterministic mock.

    Since the production sprint the planner no longer falls back to the mock when
    STUDIUM_LLM_MODE is unset (it refuses with "planner model not configured"), so a
    test that wants the mock selects it explicitly, as services/planner/conftest.py does.
    """
    monkeypatch.setenv("STUDIUM_LLM_MODE", "mock")
