"""What is on disk: courses, evaluation runs and validity suites.

Discovery is by directory convention, re-run on every request, and it never raises: a
missing or unreadable root yields a problem line and an empty map (spec constraint N3).
An id is a key of one of these maps and is only ever resolved through it -- no path
segment from a URL is joined to a root, so a crafted id cannot leave the configured
roots.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from observatory_config import ObservatoryConfig

ASTRA_FILE = "astra.yaml"
AUDIT_FILE = "audit.json"
SESSIONS_DIR = "sessions"
SUITE_README = "README.md"

#: `<corpus>-<mode>-<YYYYmmdd>-<HHMMSS>`, the shape `eval/harness` writes:
#: "01-claude-20260615-151816", "smoke-m3-20260615-120000".
RUN_DIRNAME_RE = re.compile(r"^(?P<corpus>.+?)-(?P<mode>[^-]+)-(?P<ts>\d{8}-\d{6})$")


@dataclass(frozen=True)
class CourseRef:
    id: str
    path: Path
    source: str  # "root" | "explicit"


@dataclass(frozen=True)
class RunRef:
    id: str
    path: Path


@dataclass(frozen=True)
class SuiteRef:
    name: str
    path: Path


@dataclass(frozen=True)
class Inventory:
    courses: dict[str, CourseRef] = field(default_factory=dict)
    runs: dict[str, RunRef] = field(default_factory=dict)
    suites: dict[str, SuiteRef] = field(default_factory=dict)
    problems: tuple[str, ...] = ()


def parse_run_dirname(name: str) -> dict[str, str | None]:
    """Corpus, author mode and timestamp from a run directory name; all None otherwise."""
    match = RUN_DIRNAME_RE.match(name)
    if match is None:
        return {"corpus_id": None, "author_mode": None, "timestamp": None}
    return {"corpus_id": match.group("corpus"), "author_mode": match.group("mode"),
            "timestamp": match.group("ts")}


def _children(root: Path, problems: list[str], label: str) -> list[Path]:
    """Direct child directories of `root`, sorted by name; a fault becomes a problem."""
    if not root.is_dir():
        problems.append(f"{label} missing: {root}")
        return []
    try:
        return sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name)
    except OSError as exc:
        problems.append(f"{label} unreadable: {root} ({type(exc).__name__}: {exc})")
        return []


def _unique(name: str, taken: dict[str, object], path: Path, problems: list[str]) -> str:
    if name not in taken:
        return name
    suffix = 2
    while f"{name}~{suffix}" in taken:
        suffix += 1
    unique = f"{name}~{suffix}"
    problems.append(f"duplicate course name {name!r}: {path} is listed as {unique}")
    return unique


def _mtime(path: Path) -> int:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def discover(cfg: ObservatoryConfig) -> Inventory:
    """Scan the configured roots. Cheap enough to run per request; nothing is cached."""
    problems: list[str] = list(cfg.raw_problems)

    courses: dict[str, CourseRef] = {}
    # A missing course root is only a fault when no course was named explicitly, the
    # rule ObservatoryConfig.problems() applies.
    root_children = ([] if cfg.courses and not cfg.course_root.is_dir()
                     else _children(cfg.course_root, problems, "course root"))
    for path in root_children:
        if (path / ASTRA_FILE).is_file():
            courses[path.name] = CourseRef(path.name, path, "root")
    for path in cfg.courses:
        if not (path / ASTRA_FILE).is_file():
            problems.append(f"explicit course has no {ASTRA_FILE}: {path}")
            continue
        key = _unique(path.name, courses, path, problems)
        courses[key] = CourseRef(key, path, "explicit")

    run_dirs = [p for p in _children(cfg.eval_root, problems, "eval root")
                if (p / AUDIT_FILE).is_file() or (p / SESSIONS_DIR).is_dir()]
    run_dirs.sort(key=lambda p: (parse_run_dirname(p.name)["timestamp"] or "", _mtime(p)),
                  reverse=True)
    runs = {p.name: RunRef(p.name, p) for p in run_dirs}

    suites = {p.name: SuiteRef(p.name, p)
              for p in _children(cfg.validity_root, problems, "validity root")
              if (p / SUITE_README).is_file()}

    return Inventory(courses=courses, runs=runs, suites=suites, problems=tuple(problems))
