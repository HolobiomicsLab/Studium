"""Where the Observatory finds the rest of the repository.

The service holds flat, prefixed modules (no package) so `uvicorn observatory_app:app`
works from this directory; the readers it imports live in the planner and in the eval
harness, which are themselves flat module trees put on `sys.path` by their own entry
points. `ensure_importable()` does the same here, with the same shape as
`eval/harness/paths.py::ensure_planner_importable`.
"""
from __future__ import annotations

import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(__file__).resolve().parents[2]
PLANNER_DIR = REPO_ROOT / "services" / "planner"
PLANNER_TESTS_DIR = PLANNER_DIR / "tests"  # astra_course_fixture: the demo course builder
EVAL_DIR = REPO_ROOT / "eval"
TOOLS_DIR = REPO_ROOT / "tools"
TEMPLATES_DIR = SERVICE_DIR / "templates"

#: Inserted at the front of `sys.path`, in this order, when absent.
IMPORT_DIRS = (SERVICE_DIR, PLANNER_DIR, EVAL_DIR, TOOLS_DIR)


def ensure_importable() -> None:
    """Put the service, the planner, the eval harness and the tools on `sys.path`."""
    for directory in IMPORT_DIRS:
        entry = str(directory)
        if entry not in sys.path:
            sys.path.insert(0, entry)
