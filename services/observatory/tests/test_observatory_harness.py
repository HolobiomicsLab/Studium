"""The Harness tab (spec R7), and the two files it must never read.

R7 asks for "an explicit session directory: `index.json` as a step table, the current
`task.md`, the last `feedback.md`, refreshed by polling the files' mtimes. No file watcher
dependency." The interesting half is not what is rendered — it is what is next to it on
disk. `.studium-session/` also holds `response.json` and `run_result.json`, the learner's
own submission and their own executed result, and N1 forbids putting a free-text field of
learner origin on any tab. So the omission is tested as a behaviour, with a canary written
into both files, rather than trusted to a constant nobody exercises.

The file names live in TypeScript and Python cannot import them, so `READ_FILES` mirrors
`FILES` in `session-workspace.ts`. `test_the_python_names_match_the_typescript_protocol`
reads that source and compares: the TS/Py `over_distrust` drift is why a mirror that
nothing checks is not accepted here.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import re
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from observatory_app import create_app
from observatory_config import (
    DEFAULT_HARNESS_REFRESH,
    ENV_HARNESS_REFRESH,
    ENV_SESSION_DIRS,
    ObservatoryConfig,
)
from observatory_harness import (
    FEEDBACK_FILE,
    INDEX_FILE,
    LEARNER_FILES,
    READ_FILES,
    SESSION_DIRNAME,
    STEP_STATUSES,
    TASK_FILE,
    harness_detail,
    resolve,
    session_dirs_from,
)
from observatory_paths import REPO_ROOT

#: The canary. Written into the two learner files of every fixture session, so every test
#: that renders a page is also a privacy test.
CANARY = "SECRET-LEARNER-PROSE-4b1f"

_INDEX = {
    "session_id": "sess-2026-09-09-a",
    "entries": [
        {"step": 1, "scene_id": "intro-1", "scene_type": "intro", "status": "complete"},
        {"step": 2, "scene_id": "quiz-1", "scene_type": "quiz", "status": "graded",
         "passed": True},
        {"step": 3, "scene_id": "repro-1", "scene_type": "reproduction",
         "status": "awaiting_run", "landmark": "figure-2",
         # An absolute path: the shape `run_result.json` really carries.
         "artifacts": ["/Users/someone/work/run-42/figure_2.png"]},
    ],
}


def _session_dir(root: Path, name: str = "workspace", *, index: object = _INDEX,
                 task: str | None = "# Step 3\n\nReproduce figure 2.\n",
                 feedback: str | None = "Correct. Moving to the next step.\n") -> Path:
    """One workspace holding a `.studium-session/` in the real shape, canaries included."""
    protocol = root / name / SESSION_DIRNAME
    protocol.mkdir(parents=True)
    if index is not None:
        text = index if isinstance(index, str) else json.dumps(index, indent=2)
        (protocol / INDEX_FILE).write_text(text, encoding="utf-8")
    if task is not None:
        (protocol / TASK_FILE).write_text(task, encoding="utf-8")
    if feedback is not None:
        (protocol / FEEDBACK_FILE).write_text(feedback, encoding="utf-8")
    # The two files that must never be read, each carrying the canary in the shape its
    # own writer uses.
    (protocol / "response.json").write_text(
        json.dumps({"kind": "explanation", "text": CANARY}), encoding="utf-8")
    (protocol / "run_result.json").write_text(
        json.dumps({"passed": False, "stderr": CANARY,
                    "artifacts": ["/Users/someone/work/run-42/figure_2.png"]}),
        encoding="utf-8")
    return root / name


def _cfg(*dirs: Path, refresh: int = DEFAULT_HARNESS_REFRESH,
         base: ObservatoryConfig | None = None) -> ObservatoryConfig:
    if base is None:
        base = ObservatoryConfig.from_env({})
    return dataclasses.replace(base, session_dirs=tuple(dirs), harness_refresh=refresh)


# ------------------------------------------------------------------ D1: what a path names


def test_either_the_workspace_or_the_protocol_directory_resolves(tmp_path) -> None:
    """An operator thinks in workspaces. Requiring the dotted child would render an empty
    page with no reason — the failure this accepts both forms to prevent."""
    workspace = _session_dir(tmp_path)
    protocol = workspace / SESSION_DIRNAME

    assert resolve(workspace) == (protocol, None)
    assert resolve(protocol) == (protocol, None)


def test_a_path_that_names_no_session_gives_a_reason_and_not_an_empty_page(tmp_path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    resolved, why = resolve(empty)
    assert resolved is None
    assert SESSION_DIRNAME in why and str(empty) in why

    absent = tmp_path / "nope"
    assert resolve(absent) == (None, f"missing: {absent}")

    afile = tmp_path / "afile"
    afile.write_text("x", encoding="utf-8")
    assert resolve(afile) == (None, f"not a directory: {afile}")


def test_a_named_directory_that_is_missing_is_a_configuration_problem(tmp_path) -> None:
    absent = tmp_path / "nope"
    cfg = ObservatoryConfig.from_env({ENV_SESSION_DIRS: str(absent)})
    assert f"session workspace missing: {absent}" in cfg.problems()
    # And the page still renders, naming the fault per session (N3).
    detail = harness_detail(cfg)
    assert detail["configured"] is True
    (session,) = detail["sessions"]
    assert session["problem"] == f"missing: {absent}"


def test_session_dirs_are_pathsep_separated_and_resolved(tmp_path, monkeypatch) -> None:
    a = _session_dir(tmp_path, "a")
    b = _session_dir(tmp_path, "b")
    monkeypatch.chdir(tmp_path)
    assert session_dirs_from(f"a{os.pathsep}b") == (a.resolve(), b.resolve())
    assert session_dirs_from(f"a{os.pathsep}{os.pathsep} ") == (a.resolve(),)
    assert session_dirs_from("") == ()

    cfg = ObservatoryConfig.from_env({ENV_SESSION_DIRS: f"{a}{os.pathsep}{b}"})
    assert cfg.session_dirs == (a.resolve(), b.resolve())
    assert [s["name"] for s in harness_detail(cfg)["sessions"]] == ["a", "b"]


def test_no_named_directory_says_so_rather_than_scanning(tmp_path) -> None:
    cfg = ObservatoryConfig.from_env({})
    assert cfg.session_dirs == ()
    detail = harness_detail(cfg)
    assert detail["configured"] is False and detail["sessions"] == []
    assert any(ENV_SESSION_DIRS in note for note in cfg.notes())


# ------------------------------------------------------------------ D2: the canary


@pytest.fixture
def client(tmp_path):
    workspace = _session_dir(tmp_path)
    return TestClient(create_app(_cfg(workspace))), workspace


def test_the_learner_files_reach_no_payload_and_no_page(client) -> None:
    """The prohibition as a behaviour, not as a constant.

    `LEARNER_FILES` is iterated rather than spelled out here: a name added to the module's
    exclusion list is a name this probe covers, with nothing to remember.
    """
    http, workspace = client
    protocol = workspace / SESSION_DIRNAME
    for name in LEARNER_FILES:
        assert (protocol / name).is_file(), f"the fixture must plant {name} for this to prove"
        assert CANARY in (protocol / name).read_text(encoding="utf-8")

    for url in ("/harness", "/api/harness"):
        text = http.get(url).text
        assert CANARY not in text, f"a learner's own prose reached {url}"
        for name in LEARNER_FILES:
            assert name not in text or url.endswith("harness"), name

    # The two names DO appear — as the stated omission, never as content.
    page = http.get("/harness").text
    for name in LEARNER_FILES:
        assert name in page, f"{name} must be named as not read, so an operator can see it"
    assert json.dumps(harness_detail(_cfg(workspace))).count(CANARY) == 0


def test_the_module_reads_exactly_three_files_and_they_are_the_three_r7_names() -> None:
    assert READ_FILES == (INDEX_FILE, TASK_FILE, FEEDBACK_FILE)
    assert set(READ_FILES) == {"index.json", "task.md", "feedback.md"}
    assert not set(READ_FILES) & set(LEARNER_FILES)


def test_no_file_outside_read_files_is_opened(tmp_path, monkeypatch) -> None:
    """The strongest form: every `open` under a session directory is recorded and the set of
    basenames touched is compared to `READ_FILES`. A future reader that reaches for
    `run_result.json` to enrich the step table fails here, whatever it does with the value."""
    workspace = _session_dir(tmp_path)
    opened: list[str] = []
    real_read_text = Path.read_text
    real_open = Path.open

    def spy_read_text(self, *a, **kw):
        opened.append(str(self))
        return real_read_text(self, *a, **kw)

    def spy_open(self, *a, **kw):
        opened.append(str(self))
        return real_open(self, *a, **kw)

    monkeypatch.setattr(Path, "read_text", spy_read_text)
    monkeypatch.setattr(Path, "open", spy_open)
    harness_detail(_cfg(workspace))
    monkeypatch.undo()

    under = [p for p in opened if str(workspace) in p]
    assert under, "the reader must have read something, or this test proves nothing"
    assert {Path(p).name for p in under} <= set(READ_FILES)


# ------------------------------------------------------------------ D3: the TS mirror


def test_the_python_names_match_the_typescript_protocol() -> None:
    """`FILES` in `session-workspace.ts` is the protocol's one definition; this is a mirror.

    R9 forbids a second declaration and Python cannot import a TS constant, so the mirror is
    CHECKED rather than merely copied. A rename in the protocol turns this suite red naming
    the drift, instead of leaving the Harness tab rendering an empty session for ever.
    """
    source = (REPO_ROOT / "packages" / "lesson-session-host" / "src"
              / "session-workspace.ts").read_text(encoding="utf-8")
    literal = re.search(r"const FILES = \{(.*?)\} as const;", source, re.S)
    assert literal, "the FILES literal moved; this mirror needs re-pointing, not deleting"
    names = set(re.findall(r'"([^"]+)"', literal.group(1)))
    assert names, "the extraction matched nothing — a green test measuring nothing"

    assert set(READ_FILES) <= names, f"renamed in the protocol: {set(READ_FILES) - names}"
    assert set(LEARNER_FILES) <= names, "the exclusion list names files that no longer exist"
    # A SEVENTH file added to the protocol lands here, and someone decides whether it is
    # rendered or excluded. `run.json` is Studium's own run manifest: not learner prose, and
    # not one of R7's three, so it is neither read nor listed as withheld.
    assert names - set(READ_FILES) - set(LEARNER_FILES) == {"run.json"}

    # The directory name has its own declaration, in the extension that opens the channel.
    extension = (REPO_ROOT / "apps" / "studium-vscode" / "src"
                 / "extension.ts").read_text(encoding="utf-8")
    assert f'const SESSION_DIR = "{SESSION_DIRNAME}"' in extension


def test_the_step_statuses_match_the_typescript_entry_type() -> None:
    source = (REPO_ROOT / "packages" / "lesson-session-host" / "src"
              / "session-workspace.ts").read_text(encoding="utf-8")
    declared = re.search(r"status:\s*((?:\"[a-z_]+\"\s*\|\s*)+\"[a-z_]+\")", source)
    assert declared, "WorkspaceStepEntry.status moved; re-point this mirror"
    assert set(re.findall(r'"([a-z_]+)"', declared.group(1))) == set(STEP_STATUSES)


# ------------------------------------------------------------------ N3: fail-soft


def test_an_unparsable_index_gives_a_reason_and_the_other_two_files_still_render(
        tmp_path) -> None:
    workspace = _session_dir(tmp_path, index="{ not json")
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert session["steps"] == []
    assert "not JSON" in session["steps_problem"]
    assert session["files"][TASK_FILE]["state"] == "ok"
    assert session["files"][FEEDBACK_FILE]["state"] == "ok"


@pytest.mark.parametrize("payload, expected", [
    ([1, 2, 3], "index.json is a list, expected an object"),
    ({"session_id": "s"}, "index.json has no `entries`"),
    ({"entries": {"step": 1}}, "`entries` is a dict, expected a list"),
])
def test_a_wrong_shaped_index_is_a_reason_and_never_a_silent_empty_table(
        tmp_path, payload, expected) -> None:
    """An empty step table reads as "this session has taken no step" — a claim about the
    session, and a false one. The wrong-type trap is a known way to lose a whole page here."""
    workspace = _session_dir(tmp_path, index=payload)
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert session["steps"] == []
    assert session["steps_problem"] == expected


def test_a_malformed_entry_is_marked_and_its_neighbours_survive(tmp_path) -> None:
    workspace = _session_dir(tmp_path, index={
        "session_id": "s", "entries": [{"step": 1, "scene_id": "a", "status": "complete"},
                                       "not-a-dict",
                                       {"step": 2, "scene_id": "b", "status": "graded"}]})
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert [row["scene_id"] for row in session["steps"]] == ["a", None, "b"]
    assert session["steps"][1]["malformed"] == "entry is a str"
    assert session["current_step"] == 2 and session["status"] == "graded"


def test_an_unreadable_file_is_a_state_and_a_reason(tmp_path) -> None:
    workspace = _session_dir(tmp_path)
    target = workspace / SESSION_DIRNAME / TASK_FILE
    target.chmod(0)
    try:
        if os.access(target, os.R_OK):  # running as root: the mode says nothing
            pytest.skip("cannot make a file unreadable here")
        (session,) = harness_detail(_cfg(workspace))["sessions"]
        assert session["files"][TASK_FILE]["state"] == "unreadable"
        assert session["files"][TASK_FILE]["reason"]
        assert session["files"][INDEX_FILE]["state"] == "ok"  # the page is not lost
    finally:
        target.chmod(stat.S_IRUSR | stat.S_IWUSR)


def test_an_absent_file_is_not_a_fault(tmp_path) -> None:
    """`feedback.md` does not exist until a first response is graded."""
    workspace = _session_dir(tmp_path, feedback=None)
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert session["files"][FEEDBACK_FILE] == {
        "state": "absent", "text": None, "mtime": None, "reason": None}
    assert session["steps"], "the rest of the session still renders"


def test_a_session_with_no_index_yet_still_names_its_files(tmp_path) -> None:
    workspace = _session_dir(tmp_path, index=None, feedback=None)
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert session["problem"] is None  # task.md alone is enough to be a session directory
    assert session["steps"] == [] and session["steps_problem"] is None
    assert session["current_step"] is None and session["status"] is None


# ------------------------------------------------------------------ D4: the poll


def test_every_read_file_carries_its_mtime(tmp_path) -> None:
    """R7's "refreshed by polling the files' mtimes": the mtimes have to be ON the page, or
    an operator cannot tell a live session from a stalled one."""
    workspace = _session_dir(tmp_path)
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    for name in READ_FILES:
        assert session["files"][name]["mtime"], f"{name} has no mtime"
        assert session["files"][name]["mtime"].endswith("+00:00"), "mtimes are UTC ISO"

    before = session["files"][TASK_FILE]["mtime"]
    path = workspace / SESSION_DIRNAME / TASK_FILE
    os.utime(path, (0, 0))
    (again,) = harness_detail(_cfg(workspace))["sessions"]
    assert again["files"][TASK_FILE]["mtime"] != before, "the stamp is read, not cached"


def test_the_page_polls_itself_and_the_json_twin_does_not(tmp_path) -> None:
    """No watcher (R7) and no server state (R8), so the poll is the page's own meta refresh.
    A client of the JSON twin owns its interval; a refresh header there would impose one."""
    workspace = _session_dir(tmp_path)
    http = TestClient(create_app(_cfg(workspace, refresh=7)))

    page = http.get("/harness")
    assert '<meta http-equiv="refresh" content="7">' in page.text
    assert "every 7s" in page.text

    twin = http.get("/api/harness")
    assert "refresh" not in {k.lower() for k in twin.headers}
    assert twin.json()["refresh_seconds"] == 7


def test_zero_turns_the_refresh_off_and_says_so(tmp_path) -> None:
    workspace = _session_dir(tmp_path)
    http = TestClient(create_app(_cfg(workspace, refresh=0)))
    page = http.get("/harness")
    assert "http-equiv=\"refresh\"" not in page.text
    assert "refresh is off" in page.text


@pytest.mark.parametrize("raw", ["-1", "notanumber", ""])
def test_an_unusable_refresh_keeps_the_default_and_is_reported(raw) -> None:
    """A negative interval is not "off" — `0` is, and it is spelled out. A value that cannot
    be used keeps the default rather than removing the bound (the validator-timeout pattern)."""
    cfg = ObservatoryConfig.from_env({ENV_HARNESS_REFRESH: raw})
    assert cfg.harness_refresh == DEFAULT_HARNESS_REFRESH
    if raw.strip():
        assert any("harness refresh" in line for line in cfg.problems())
    else:
        assert not any("harness refresh" in line for line in cfg.problems())


def test_a_usable_refresh_is_taken(tmp_path) -> None:
    assert ObservatoryConfig.from_env({ENV_HARNESS_REFRESH: "30"}).harness_refresh == 30
    assert ObservatoryConfig.from_env({ENV_HARNESS_REFRESH: "0"}).harness_refresh == 0


# ------------------------------------------------------------------ D5: artifact names


def test_an_artifact_is_rendered_by_basename(client) -> None:
    """The list comes from the learner's own `run_result.json` by way of `index.json`. A file
    name is not learner data; a PATH is where a home directory, and therefore a name, leaks."""
    http, workspace = client
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    (row,) = [r for r in session["steps"] if r["artifacts"]]
    assert row["artifacts"] == ["figure_2.png"]
    # `index.json` is a step table, never a rendered document: carrying its raw text would
    # put the very paths `_artifact_name` strips back on the page, unfiltered.
    assert session["files"][INDEX_FILE]["text"] is None
    assert session["files"][INDEX_FILE]["state"] == "ok"  # still known to be present, and when

    for url in ("/harness", "/api/harness"):
        text = http.get(url).text
        assert "figure_2.png" in text
        assert "/Users/someone" not in text, f"a home directory reached {url}"


def test_a_wrong_typed_artifact_list_does_not_kill_the_row(tmp_path) -> None:
    workspace = _session_dir(tmp_path, index={
        "session_id": "s",
        "entries": [{"step": 1, "scene_id": "a", "status": "ran", "artifacts": "one.png"},
                    {"step": 2, "scene_id": "b", "status": "ran", "artifacts": [7, None]}]})
    (session,) = harness_detail(_cfg(workspace))["sessions"]
    assert session["steps"][0]["artifacts"] is None       # a string is not a list of names
    assert session["steps"][1]["artifacts"] == ["7", "None"]
    assert session["steps_problem"] is None


# ------------------------------------------------------------------ R8: read-only


def _snapshot(root: Path) -> dict[str, tuple[int, str]]:
    return {
        str(path.relative_to(root)): (
            path.stat().st_mtime_ns, hashlib.sha256(path.read_bytes()).hexdigest())
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def test_the_new_routes_are_gets_and_write_nothing_under_a_session(client) -> None:
    http, workspace = client
    before = _snapshot(workspace)
    assert before, "the fixture must contain files, or this proves nothing"

    for url in ("/harness", "/api/harness"):
        assert http.get(url).status_code == 200
        # Every other verb: the route exists for GET alone.
        for verb in ("post", "put", "patch", "delete"):
            assert getattr(http, verb)(url).status_code == 405, f"{verb.upper()} {url}"

    assert _snapshot(workspace) == before


def test_the_routes_are_declared_get_only(client) -> None:
    http, _ = client
    routes = {r.path: r.methods for r in http.app.routes if hasattr(r, "methods")}
    for path in ("/harness", "/api/harness"):
        assert routes[path] <= {"GET", "HEAD"}, f"{path} accepts {routes[path]}"


def test_the_nav_reaches_the_tab_from_every_page(client) -> None:
    http, _ = client
    assert '<a href="/harness">Harness</a>' in http.get("/").text


def test_the_page_and_the_twin_carry_the_same_session(client) -> None:
    http, _ = client
    payload = http.get("/api/harness").json()
    page = http.get("/harness").text
    assert payload["sessions"][0]["session_id"] == _INDEX["session_id"]
    assert _INDEX["session_id"] in page
    for entry in _INDEX["entries"]:
        assert entry["scene_id"] in page
        assert entry["status"] in page
