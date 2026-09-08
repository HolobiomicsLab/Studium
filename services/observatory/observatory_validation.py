"""The real ASTRA validator, on demand, bounded and cached.

Validating spawns `astra validate` (astra-tools), the only subprocess the Observatory
starts and the only place it is not purely a reader; it runs with `--skip-evidence`, so
it stays offline. Two things keep it from being a liability on a page: a timeout, so a
pathological course yields a verdict instead of a hung request (`timed_out`), and a
cache keyed by the artifact tree, so re-reading a course costs nothing until a file
under it actually changes.

It never runs on its own: only the `/courses/<id>/validation` route passes `run=True`.
Every other view shows the last verdict for the tree as it stands, or "not run".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from observatory_paths import ensure_importable

ensure_importable()

from provenance.astra_validate import (  # noqa: E402
    INSTALL_HINT,
    AstraValidation,
    find_astra_cli,
    run_astra_validate,
)

#: Files whose content the validator reads; a change to any of them invalidates a verdict.
VALIDATED_SUFFIXES = ("*.yaml", "*.json")
PACKAGES = ("astra-spec", "astra-tools")

STATUS_OK = "ok"
STATUS_FAILED = "failed"
STATUS_TIMED_OUT = "timed_out"
STATUS_NOT_INSTALLED = "not_installed"
STATUS_NOT_RUN = "not_run"


@dataclass(frozen=True)
class ValidationView:
    """A verdict as a page shows it. `ok is None` means no verdict, not a passing one."""

    status: str
    ok: bool | None = None
    returncode: int | None = None
    output: str = ""
    cli: str | None = None
    versions: dict[str, str] = field(default_factory=dict)
    ran_at: str | None = None
    cache_key: str | None = None
    hint: str | None = None


def tree_cache_key(course_dir: Path) -> str:
    """`<n files>:<newest mtime in ns>` over the artifacts the validator reads."""
    paths = sorted(p for pattern in VALIDATED_SUFFIXES
                   for p in course_dir.rglob(pattern) if p.is_file())
    if not paths:
        return "0:0"
    newest = 0
    for path in paths:
        try:
            newest = max(newest, path.stat().st_mtime_ns)
        except OSError:
            continue
    return f"{len(paths)}:{newest}"


def installed_versions() -> dict[str, str]:
    """The installed astra packages; "absent" when the validator is not installed."""
    installed = {}
    for name in PACKAGES:
        try:
            installed[name] = version(name)
        except PackageNotFoundError:
            installed[name] = "absent"
    return installed


def _view(result: AstraValidation, key: str, versions: dict[str, str]) -> ValidationView:
    if result.timed_out:
        status = STATUS_TIMED_OUT
    elif result.ok:
        status = STATUS_OK
    else:
        status = STATUS_FAILED
    return ValidationView(status=status, ok=result.ok, returncode=result.returncode,
                          output=result.output, cli=result.cli, versions=versions,
                          ran_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                          cache_key=key)


class ValidationCache:
    """Per-process, per-course-directory verdicts, invalidated by the artifact tree."""

    def __init__(self, timeout: float | None = None) -> None:
        self.timeout = timeout
        self._views: dict[str, ValidationView] = {}

    def get(self, course_dir: Path, *, run: bool) -> ValidationView:
        key = tree_cache_key(course_dir)
        cached = self._views.get(str(course_dir))
        if cached is not None and cached.cache_key == key:
            return cached
        if not run:
            return ValidationView(status=STATUS_NOT_RUN, versions=installed_versions(),
                                  cache_key=key)

        versions = installed_versions()
        cli = find_astra_cli()
        if cli is None:
            # Not cached: installing the validator must be enough to get a verdict.
            return ValidationView(status=STATUS_NOT_INSTALLED, versions=versions,
                                  cache_key=key, hint=INSTALL_HINT,
                                  output=f"astra CLI not found; {INSTALL_HINT}")
        view = _view(run_astra_validate(course_dir, cli=cli, timeout=self.timeout),
                     key, versions)
        self._views[str(course_dir)] = view
        return view
