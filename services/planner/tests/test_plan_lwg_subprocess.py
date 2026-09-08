"""The gated LWG build must be reachable OUTSIDE pytest (INT-STUDIUM-016).

`services/planner/conftest.py` puts the three workspace packages on `sys.path`
for the test process. Production does not run under pytest: `uvicorn
planner_app:app` puts only the app's own directory there. The LWG build imports
`learning_workflow_schema`, so before this intent the build succeeded under
pytest and raised `ModuleNotFoundError` under uvicorn — caught by the
best-effort handler, invisible to the caller, and non-diagnostic in the artifact.

Every other LWG test in this directory therefore proves the build in the ONE
environment where it always worked. This one spawns a child interpreter that
imports the app the way a server does, which is why it is a subprocess test and
not a monkeypatch of `sys.path`: only a fresh interpreter has a fresh `sys.path`.

The child runs with `-E` (Python's own environment variables, PYTHONPATH
included, are ignored) from a directory outside the repository. It deliberately
does NOT use `-I` or `-S`: those also disable the user site directory, which in
CI is where the pinned dependencies live.

Known limitation: a `.pth` file in site-packages that added a package directory
would mask the defect this test guards. Nothing in the repository installs one.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Imports ONLY the planner directory — exactly what uvicorn puts on sys.path.
DRIVER = """
import json, os, sys
sys.path.insert(0, os.path.join(os.environ["STUDIUM_TEST_REPO_ROOT"], "services", "planner"))
from fastapi.testclient import TestClient
import planner_app
planner_app._get_perspicacite_client = lambda: None
resp = TestClient(planner_app.app).post("/plan", json={"manifest_id": "sp101", "target": "L3"})
print("STUDIUM_RESULT " + json.dumps({
    "status": resp.status_code,
    "has_graph": resp.json()["lesson_plan"].get("learning_workflow_graph") is not None,
}))
"""

EXPECTED_ARTIFACTS = [
    "astra.yaml",
    "lwg.graph.json",
    "lwg.indicium.jsonld",
    "trace/exploration_tree.yaml",
    "universes/baseline.yaml",
    "universes/remedial.yaml",
]


def _run_plan_outside_pytest(tmp_path):
    out_dir = tmp_path / "lwg-out"
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.update({
        "STUDIUM_TEST_REPO_ROOT": str(REPO_ROOT),
        "STUDIUM_LWG_BUILD": "on",
        "STUDIUM_LWG_OUT_DIR": str(out_dir),
    })
    env.pop("STUDIUM_EVIDENCE_ENRICH", None)
    proc = subprocess.run(
        [sys.executable, "-E", "-c", DRIVER],
        cwd=tmp_path,           # outside the repository: nothing of it on sys.path
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    return proc, out_dir


def test_lwg_build_reaches_the_emitter_without_pytest(tmp_path):
    proc, out_dir = _run_plan_outside_pytest(tmp_path)
    assert proc.returncode == 0, f"stdout:\n{proc.stdout}\nstderr:\n{proc.stderr}"

    line = [ln for ln in proc.stdout.splitlines() if ln.startswith("STUDIUM_RESULT ")]
    assert line, f"driver printed no result:\n{proc.stdout}\n{proc.stderr}"
    result = json.loads(line[0][len("STUDIUM_RESULT "):])

    # /plan answers, and the graph reaches the caller.
    assert result["status"] == 200, proc.stderr
    assert result["has_graph"] is True, (
        "the LWG build ran but attached no graph — the response is the only place "
        f"a caller can see this. stderr:\n{proc.stderr}"
    )

    # No failure marker: the build did not fall into the best-effort handler.
    course_dir = out_dir / "sp101"
    marker = course_dir / "lwg_build.telemetry.jsonl"
    assert not marker.exists(), (
        "the LWG build failed outside pytest; marker:\n"
        + marker.read_text() + f"\nstderr:\n{proc.stderr}"
    )

    # The artifacts are on disk — the whole set, not a partial write.
    written = sorted(
        str(p.relative_to(course_dir)) for p in course_dir.rglob("*") if p.is_file()
    )
    assert written == EXPECTED_ARTIFACTS, written


def test_failure_marker_names_the_exception(monkeypatch, tmp_path, caplog):
    """A marker that says only `"reason": "exception"` cannot be triaged.

    INT-STUDIUM-016 was diagnosed from a marker exactly like that: it recorded
    that the build failed, not that a module was missing. The marker now carries
    the exception type and message.
    """
    import logging

    import planner_app
    from fastapi.testclient import TestClient

    monkeypatch.setenv("STUDIUM_LWG_BUILD", "on")
    monkeypatch.setenv("STUDIUM_LWG_OUT_DIR", str(tmp_path))
    monkeypatch.delenv("STUDIUM_EVIDENCE_ENRICH", raising=False)
    monkeypatch.setattr(planner_app, "_get_perspicacite_client", lambda: None)

    def _missing_module(self, plan):  # noqa: ANN001
        raise ModuleNotFoundError("No module named 'learning_workflow_schema'")

    monkeypatch.setattr("graph.builder.GraphBuilder.build", _missing_module)

    with caplog.at_level(logging.ERROR):
        resp = TestClient(planner_app.app).post(
            "/plan", json={"manifest_id": "sp101", "target": "L3"})
    assert resp.status_code == 200

    events = [
        json.loads(line)
        for line in (tmp_path / "sp101" / "lwg_build.telemetry.jsonl").read_text().splitlines()
        if line.strip()
    ]
    failed = [e for e in events if e.get("event") == "lwg_build_failed"]
    assert failed, events
    # An import failure is distinguishable from an emitter crash...
    assert failed[0]["reason"] == "import_error", failed
    # ...and the message survives into the artifact.
    assert any(
        "ModuleNotFoundError" in err and "learning_workflow_schema" in err
        for err in failed[0].get("errors", [])
    ), failed

