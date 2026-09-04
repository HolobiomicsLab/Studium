"""Drive the Node session driver (Stage 2) from Python.

The driver imports @studium/lesson-session, which only resolves inside a
node_modules tree that has the workspace symlinks. We make the harness
self-contained by ensuring eval/harness/node_modules/@studium/lesson-session is
a symlink to packages/lesson-session (node_modules is gitignored, so this is a
local-only convenience, never committed), then run the driver with the workspace
`tsx` binary from the harness dir so resolution succeeds.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from .paths import HARNESS_DIR, REPO_ROOT, SESSION_DRIVER

#: The persona turn cap enforced by the session driver. Named so a reader of a
#: finished run (the Observatory cap-hit flag, INT-STUDIUM-008) tests against the
#: number the driver used instead of re-declaring the literal.
DEFAULT_MAX_TURNS = 60


def _find_tsx() -> Path:
    """Locate the pnpm-managed tsx CLI without invoking pnpm (faster, no recursive-exec noise)."""
    pnpm_store = REPO_ROOT / "node_modules" / ".pnpm"
    candidates = sorted(pnpm_store.glob("tsx@*/node_modules/tsx/dist/cli.mjs"))
    if not candidates:
        raise FileNotFoundError(
            "tsx CLI not found under node_modules/.pnpm — run `pnpm install` first"
        )
    return candidates[-1]


def ensure_workspace_symlink() -> None:
    """Idempotently create eval/harness/node_modules/@studium/lesson-session ->
    packages/lesson-session so the driver's bare import resolves."""
    nm = HARNESS_DIR / "node_modules" / "@studium"
    nm.mkdir(parents=True, exist_ok=True)
    link = nm / "lesson-session"
    target = REPO_ROOT / "packages" / "lesson-session"
    if link.is_symlink():
        if link.resolve() == target.resolve():
            return
        link.unlink()
    elif link.exists():
        return  # a real dir somehow — leave it
    link.symlink_to(target)


def run_session(
    bundle_path: Path,
    persona: str,
    out_dir: Path,
    live: bool = False,
    max_turns: int = DEFAULT_MAX_TURNS,
    pseudo_secret: str | None = None,
    persona_prompt: str | None = None,
    model: str | None = None,
    learner_id: str | None = None,
    timeout_s: int = 600,
) -> dict:
    """Run one persona playthrough; returns the parsed driver_result.json.

    #4: `learner_id` is threaded into LessonSession so the pseudonym is salted per learner
    (HMAC(secret, learnerId:lessonId)). Passing a distinct learner_id per persona lets the audit
    MEASURE that distinct learners on the same lesson get distinct pseudonyms — the proper fix that
    replaces the old per-persona-secret isolation workaround.
    """
    ensure_workspace_symlink()
    tsx = _find_tsx()
    out_dir.mkdir(parents=True, exist_ok=True)
    args = {
        "bundlePath": str(bundle_path),
        "persona": persona,
        "outDir": str(out_dir),
        "live": live,
        "maxTurns": max_turns,
    }
    if pseudo_secret:
        args["pseudoSecret"] = pseudo_secret
    if learner_id:
        args["learnerId"] = learner_id
    if persona_prompt:
        args["personaPrompt"] = persona_prompt
    if model:
        args["model"] = model

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(args, tf)
        args_path = tf.name

    proc = subprocess.run(
        ["node", str(tsx), str(SESSION_DRIVER), args_path],
        cwd=str(HARNESS_DIR),
        capture_output=True,
        text=True,
        timeout=timeout_s,
    )
    result_file = out_dir / "driver_result.json"
    if not result_file.exists():
        raise RuntimeError(
            f"session driver produced no result for persona {persona!r}.\n"
            f"exit={proc.returncode}\nstderr:\n{proc.stderr[:1500]}"
        )
    return json.loads(result_file.read_text(encoding="utf-8"))


__all__ = ["run_session", "ensure_workspace_symlink"]
