"""The persona turn cap is a named constant — eval.harness.runner (INT-STUDIUM-008).

The Observatory flags a session that ended at the cap rather than by completing. It
must read the same number the driver enforces, so the literal is named once here and
imported, never re-declared (slice-1 constraint R9, "reuse, no third copy").

Run:  .venv/bin/python -m pytest eval/tests/test_runner_max_turns_constant.py -q
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
if str(EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_DIR))

from harness.runner import DEFAULT_MAX_TURNS, run_session  # noqa: E402


def test_turn_cap_is_named():
    assert DEFAULT_MAX_TURNS == 60
    assert inspect.signature(run_session).parameters["max_turns"].default == DEFAULT_MAX_TURNS
