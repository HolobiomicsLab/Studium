"""End-to-end integration: author a bundle, drive >=2 personas through the real
LessonSession runtime, assert the personas BRANCH and the adaptivity machinery
fires. Key-free (live=False). Gated on the gitignored corpus + the workspace
node_modules being installed.

Run:  /Users/holobiomicslab/git/prototype-build/.venv/bin/python -m pytest eval/tests/test_drive_integration.py -q
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

EVAL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_DIR.parent
sys.path.insert(0, str(EVAL_DIR))

from harness.author import author_bundle  # noqa: E402
from harness.corpus import load_manifest  # noqa: E402

_HAS_CORPUS = (EVAL_DIR / "corpus" / "manifest.json").exists()
_HAS_TSX = bool(list((REPO_ROOT / "node_modules" / ".pnpm").glob("tsx@*/node_modules/tsx/dist/cli.mjs"))) \
    if (REPO_ROOT / "node_modules" / ".pnpm").exists() else False

pytestmark = pytest.mark.skipif(
    not (_HAS_CORPUS and _HAS_TSX),
    reason="needs gitignored corpus + installed node_modules (tsx)",
)


def _short_material():
    for m in load_manifest():
        if m.id == "04":
            return m
    return load_manifest()[0]


def test_personas_branch_and_adaptivity_fires(tmp_path):
    from harness.runner import run_session

    m = _short_material()
    res = author_bundle(m, tmp_path, mode="deterministic")

    prof = run_session(res.bundle_path, "proficient", tmp_path / "sessions" / "proficient",
                       live=False, pseudo_secret="t:proficient", max_turns=60)
    strg = run_session(res.bundle_path, "struggling", tmp_path / "sessions" / "struggling",
                       live=False, pseudo_secret="t:struggling", max_turns=60)

    assert prof["completed"] and strg["completed"]
    # personas must branch: struggling needs strictly more turns (replays) than proficient
    assert strg["n_turns"] > prof["n_turns"], (prof["n_turns"], strg["n_turns"])
    assert "replay" in strg["transition_kinds"]
    assert "replay" not in prof["transition_kinds"]


def test_authored_bundle_exercises_prereq_gate_and_escalation(tmp_path):
    import json

    from harness.runner import run_session

    m = _short_material()
    res = author_bundle(m, tmp_path, mode="deterministic")
    out = tmp_path / "sessions" / "struggling"
    run_session(res.bundle_path, "struggling", out, live=False,
                pseudo_secret="t:struggling", max_turns=60)
    tele = [json.loads(l) for l in (out / "telemetry.jsonl").read_text().splitlines() if l.strip()]
    rules = {e.get("rule_id") for e in tele if e.get("type") == "adaptation_applied"}
    assert "graph_prereq_gate" in rules, "authored LWG must exercise prereq gating (#6)"
    assert "graph_universe_escalated" in rules, "repeated remediation must escalate baseline->remedial (#6)"
