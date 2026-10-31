"""Shared pytest setup for the tools/ suite.

Since the production sprint the planner no longer falls back to its deterministic mock when
STUDIUM_LLM_MODE is unset (it refuses with "planner model not configured"). The composition-chain
tests (test_compose_lesson.py) run the planner in process, so they select the mock explicitly, the
same way services/planner/conftest.py and services/ingest/conftest.py do. No paid call is made.
"""
import pytest


@pytest.fixture(autouse=True)
def explicit_planner_mock(monkeypatch):
    monkeypatch.setenv("STUDIUM_LLM_MODE", "mock")
