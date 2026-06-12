"""Repo-root / path resolution for the eval harness.

Everything is computed relative to this file so the harness is runnable from any
cwd (agent threads reset cwd between bash calls — rule from the project brief).
"""

from __future__ import annotations

import sys
from pathlib import Path

# eval/harness/paths.py -> eval/harness -> eval -> <repo root>
HARNESS_DIR = Path(__file__).resolve().parent
EVAL_DIR = HARNESS_DIR.parent
REPO_ROOT = EVAL_DIR.parent

CORPUS_DIR = EVAL_DIR / "corpus"
CORPUS_MANIFEST = CORPUS_DIR / "manifest.json"
REPORTS_DIR = EVAL_DIR / "reports"

SCENE_SYNTH_DIR = REPO_ROOT / "services" / "scene-synth"
PLANNER_DIR = REPO_ROOT / "services" / "planner"
FIXTURES_DIR = REPO_ROOT / "fixtures"

VENV_PYTHON = REPO_ROOT / ".venv" / "bin" / "python"

# The Node driver that loops start()/respond() over @studium/lesson-session.
SESSION_DRIVER = HARNESS_DIR / "drive_session.mjs"


def ensure_scene_synth_importable() -> None:
    """Put services/scene-synth on sys.path so ``import bundler`` / ``scene_synth_schemas``
    resolve. scene-synth uses flat module names (rule 004) and assumes its own dir is
    importable, mirroring how its own pytest runs.
    """
    p = str(SCENE_SYNTH_DIR)
    if p not in sys.path:
        sys.path.insert(0, p)


PERSPICACITE_DIR = REPO_ROOT / "packages" / "perspicacite-client" / "python"


def ensure_perspicacite_importable() -> None:
    """Put packages/perspicacite-client/python on sys.path (mirrors scene-synth)."""
    import sys
    p = str(PERSPICACITE_DIR)
    if p not in sys.path:
        sys.path.insert(0, p)
