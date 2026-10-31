"""Test-time import paths for the planner service.

Delegates to `planner_paths.ensure_importable()` (INT-STUDIUM-016) so the pytest
process and the uvicorn process register the same directories by the same
mechanism. The service directory is inserted here first: `services/planner` holds
an `__init__.py`, so pytest may import this file as `planner.conftest` with only
`services/` on `sys.path`, and `planner_paths` would not yet be importable.

Still needed after INT-STUDIUM-016: several tests import a workspace package
WITHOUT importing `planner_app` (`test_graph_builder.py`,
`test_graph_builder_mode_b.py`, `test_abs_capsule_import.py`).
"""
import os
import sys

import pytest

_DIR = os.path.dirname(os.path.abspath(__file__))
if _DIR not in sys.path:
    sys.path.insert(0, _DIR)

from planner_paths import ensure_importable  # noqa: E402

ensure_importable()


@pytest.fixture(autouse=True)
def explicit_research_mock(monkeypatch):
    """Keep deterministic planner fixtures behind an explicit mock selection."""
    monkeypatch.setenv("STUDIUM_LLM_MODE", "mock")
