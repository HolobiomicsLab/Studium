"""Ensure the repo root is importable so `eval.validity.persona_validation.*`
resolves regardless of pytest's rootdir/testpaths config (the repo `pytest.ini`
pins testpaths=packages; this harness lives under eval/).
"""

import os
import sys

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
