"""The Harness tab: one read-only view over an agentic session's `.studium-session/` folder.

Spec R7 — "for an explicit session directory: `index.json` as a step table, the current
`task.md`, the last `feedback.md`, refreshed by polling the files' mtimes. No file watcher
dependency."

**Three files are read, and the omission is the point.** The protocol folder also holds
`response.json` and `run_result.json`, which are the LEARNER'S OWN submission and the
learner's own executed result. N1 forbids rendering a free-text field of learner origin on
any tab, so those two names are absent from `READ_FILES` and a probe test writes a canary
into both and asserts it reaches no payload and no page. `task.md` is safe by construction —
`publicScene` strips the answer key before the file is written — and `feedback.md` cannot
echo a response: `renderFeedback` in `session-workspace.ts` is a closed set of transition
messages.

The names themselves live in TypeScript (`FILES` in
`packages/lesson-session-host/src/session-workspace.ts`) and Python cannot import them, so
`READ_FILES` is a mirror. R9 forbids a second declaration, and a mirror that nothing checks is
how the TS/Py `over_distrust` drift happened here before; `test_observatory_harness.py` reads
the TypeScript and asserts the two agree, so a rename in the protocol turns this suite red
naming the drift instead of rendering an empty page.

Nothing here raises (N3): an unreadable file becomes a state and a reason on the page.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from observatory_config import ObservatoryConfig

#: The protocol directory a workspace carries. Mirrored from `session-workspace.ts`.
SESSION_DIRNAME = ".studium-session"

#: The three files R7 names, and no others. `response.json` / `run_result.json` are the
#: learner's own words and results; see the module docstring.
INDEX_FILE = "index.json"
TASK_FILE = "task.md"
FEEDBACK_FILE = "feedback.md"
READ_FILES = (INDEX_FILE, TASK_FILE, FEEDBACK_FILE)

#: Written by the operator, never read here. Named so the prohibition is greppable and so the
#: canary test has one list to iterate rather than a hand-written pair.
LEARNER_FILES = ("response.json", "run_result.json")

#: The statuses `WorkspaceStepEntry` declares, in the order a session passes through them.
STEP_STATUSES = ("awaiting_response", "awaiting_run", "ran", "graded", "complete")


def _stamp(path: Path) -> str | None:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except OSError:
        return None


def _read(path: Path) -> dict:
    """One file as `{state, text, mtime}`. `state` is `ok`, `absent` or `unreadable`.

    An absent file is not a fault: `feedback.md` does not exist until the first response is
    graded, and a folder that has only just been created has none of the three. The
    distinction matters to an operator, who otherwise cannot tell "no session has started"
    from "I cannot read your disk".
    """
    if not path.exists():
        return {"state": "absent", "text": None, "mtime": None, "reason": None}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return {"state": "unreadable", "text": None, "mtime": _stamp(path),
                "reason": f"{type(exc).__name__}: {exc}"}
    return {"state": "ok", "text": text, "mtime": _stamp(path), "reason": None}


def _artifact_name(value: object) -> str:
    """An artifact rendered by BASENAME (plan D5).

    The list comes from the learner's own `run_result.json` by way of `index.json`. A file
    name is not learner data; a PATH is where a home directory, and therefore a name, leaks.
    """
    return Path(str(value)).name


def _entries(payload: object) -> tuple[list[dict], str | None]:
    """The step table, or a reason it could not be built.

    A document of the wrong shape is a reason, not an exception and not a silent empty table:
    an empty table reads as "this session has taken no step", which would be a claim about the
    session and a false one.
    """
    if not isinstance(payload, dict):
        return [], f"index.json is a {type(payload).__name__}, expected an object"
    raw = payload.get("entries")
    if raw is None:
        return [], "index.json has no `entries`"
    if not isinstance(raw, list):
        return [], f"`entries` is a {type(raw).__name__}, expected a list"
    rows: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            rows.append({"step": None, "scene_id": None, "scene_type": None,
                         "status": None, "malformed": f"entry is a {type(item).__name__}"})
            continue
        artifacts = item.get("artifacts")
        rows.append({
            "step": item.get("step"),
            "scene_id": item.get("scene_id"),
            "scene_type": item.get("scene_type"),
            "status": item.get("status"),
            "landmark": item.get("landmark"),
            "passed": item.get("passed"),
            "artifacts": ([_artifact_name(a) for a in artifacts]
                          if isinstance(artifacts, list) else None),
            "malformed": None,
        })
    return rows, None


def resolve(path: Path) -> tuple[Path | None, str | None]:
    """The session directory a named path stands for, or a reason there is none.

    Either form is accepted: the protocol directory itself, or the workspace holding one
    (plan D1). An operator thinks in workspaces, and requiring the dotted child yields an
    empty page with no reason — the failure mode this function exists to prevent.
    """
    if not path.exists():
        return None, f"missing: {path}"
    if not path.is_dir():
        return None, f"not a directory: {path}"
    if any((path / name).exists() for name in READ_FILES):
        return path, None
    nested = path / SESSION_DIRNAME
    if nested.is_dir():
        return nested, None
    return None, (f"no session protocol here: neither {'/'.join(READ_FILES)} nor "
                  f"{SESSION_DIRNAME}/ under {path}")


def _session(named: Path) -> dict:
    directory, problem = resolve(named)
    if directory is None:
        return {"name": named.name, "path": str(named), "resolved": None,
                "problem": problem, "session_id": None, "steps": [], "steps_problem": None,
                "files": {name: {"state": "absent", "text": None, "mtime": None,
                                 "reason": None} for name in READ_FILES},
                "current_step": None, "status": None}

    files = {name: _read(directory / name) for name in READ_FILES}

    session_id: str | None = None
    steps: list[dict] = []
    steps_problem: str | None = None
    index = files[INDEX_FILE]
    if index["state"] == "ok":
        try:
            payload = json.loads(index["text"])
        except json.JSONDecodeError as exc:
            steps_problem = f"index.json is not JSON ({exc.msg} at line {exc.lineno})"
        else:
            steps, steps_problem = _entries(payload)
            if isinstance(payload, dict):
                raw_id = payload.get("session_id")
                session_id = raw_id if isinstance(raw_id, str) else None
    elif index["state"] == "unreadable":
        steps_problem = f"index.json unreadable ({index['reason']})"

    # `index.json` is rendered as a STEP TABLE, never as text, and its raw text must not
    # travel: the entries carry artifact PATHS, which `_artifact_name` strips for the table
    # (D5) and which the raw document would put straight back on the page and in the JSON
    # twin. A field with no renderer is not harmless — it is the copy nothing filters.
    files[INDEX_FILE] = dict(files[INDEX_FILE], text=None)

    last = steps[-1] if steps else None
    return {
        "name": named.name,
        "path": str(named),
        "resolved": str(directory),
        "problem": None,
        "session_id": session_id,
        "steps": steps,
        "steps_problem": steps_problem,
        "files": files,
        "current_step": last["step"] if last else None,
        "status": last["status"] if last else None,
    }


def harness_detail(cfg: ObservatoryConfig) -> dict:
    """Every named session directory, in the order the operator named them."""
    return {
        "configured": bool(cfg.session_dirs),
        "refresh_seconds": cfg.harness_refresh,
        "read_files": list(READ_FILES),
        # Named rather than indexed: the page shows two of the three whole, and
        # `read_files[1]` in a template is a positional dependency on a tuple's order.
        "task_file": TASK_FILE,
        "feedback_file": FEEDBACK_FILE,
        "not_read": list(LEARNER_FILES),
        "sessions": [_session(p) for p in cfg.session_dirs],
        "note": ("`response.json` and `run_result.json` are deliberately not read: they carry "
                 "the learner's own submission and their own executed result. Artifact names "
                 "are shown without their directory."),
    }


def session_dirs_from(raw: str) -> tuple[Path, ...]:
    """`os.pathsep`-separated directories, resolved. Empty entries are dropped."""
    return tuple(Path(entry).expanduser().resolve()
                 for entry in raw.split(os.pathsep) if entry.strip())
