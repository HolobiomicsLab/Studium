"""Import paths for the planner service — one mechanism (INT-STUDIUM-016).

The planner is not an installed package: it is a directory of flat modules that
imports three sibling workspace packages at runtime. Each of those packages ships
its Python under ``packages/<name>/python/<module_name>/`` — the layout
INT-STUDIUM-013 made the convention — and until this module each import site
registered its own copy of that path with an inline ``sys.path.insert``.

Three copies meant a registration could be present on one code path and absent on
another. The gated LWG build imports ``learning_workflow_schema``, whose only
registration lived in ``services/planner/conftest.py``: the build therefore worked
under pytest and raised ``ModuleNotFoundError`` under uvicorn, where the failure
was caught by the best-effort handler and never reached the caller.

One mechanism, declared here, used by every site — the shape of
``services/observatory/observatory_paths.py`` and ``eval/harness/paths.py``.
"""
from __future__ import annotations

import sys
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parents[1]
PACKAGES_DIR = REPO_ROOT / "packages"

#: The three workspace packages the planner imports at runtime.
LESSON_PLAN_SCHEMA_DIR = PACKAGES_DIR / "lesson-plan-schema" / "python"
LEARNING_WORKFLOW_SCHEMA_DIR = PACKAGES_DIR / "learning-workflow-schema" / "python"
PERSPICACITE_CLIENT_DIR = PACKAGES_DIR / "perspicacite-client" / "python"

#: Front of ``sys.path``, in this order, when absent. The service directory leads:
#: the planner's own flat modules must win over anything a package ships.
IMPORT_DIRS = (
    SERVICE_DIR,
    LESSON_PLAN_SCHEMA_DIR,
    LEARNING_WORKFLOW_SCHEMA_DIR,
    PERSPICACITE_CLIENT_DIR,
)


def ensure_importable() -> None:
    """Put the planner and the three packages it imports at runtime on ``sys.path``.

    Idempotent, and safe to call from module scope: an entry already present is
    left where it is, so a caller that arranged its own precedence keeps it.
    Inserted in reverse so a fresh path ends up ordered like :data:`IMPORT_DIRS`.
    """
    for directory in reversed(IMPORT_DIRS):
        entry = str(directory)
        if entry not in sys.path:
            sys.path.insert(0, entry)
