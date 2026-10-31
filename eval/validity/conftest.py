"""Repo root on `sys.path` for the validity suite's own tests.

Same reason as the per-tool conftests beside it: the repo `pytest.ini` pins
`testpaths=packages`, so `eval.validity.*` does not resolve from pytest's rootdir alone.
"""

import os
import sys

_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
