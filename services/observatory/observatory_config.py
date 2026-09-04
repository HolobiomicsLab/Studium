"""Observatory configuration: the roots it reads and how it is served.

Every value has a default that works in a clone with no environment set, and nothing
here raises: an unparsable value keeps its default and is reported by `problems()`, so
a mistyped variable yields a banner on the index instead of a service that will not
start. The roots are read-only for the whole service (spec constraint R8).
"""
from __future__ import annotations

import math
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from observatory_paths import EVAL_DIR, PLANNER_DIR, REPO_ROOT, ensure_importable

ensure_importable()

from harness.paths import REPORTS_DIR  # noqa: E402  (the harness owns where runs are written)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8004
DEFAULT_VALIDATOR_TIMEOUT = 60.0

#: `planner_app.py` resolves the default ".lwg" against its own working directory, so a
#: course set can sit under the service or under the repository root.
DEFAULT_COURSE_ROOTS = (PLANNER_DIR / ".lwg", REPO_ROOT / ".lwg")

ENV_COURSE_ROOT = "STUDIUM_LWG_OUT_DIR"  # the planner's own variable, not a second name
ENV_COURSES = "STUDIUM_OBS_COURSES"
ENV_EVAL_ROOT = "STUDIUM_OBS_EVAL_ROOT"
ENV_VALIDITY_ROOT = "STUDIUM_OBS_VALIDITY_ROOT"
ENV_HOST = "STUDIUM_OBS_HOST"
ENV_PORT = "STUDIUM_OBS_PORT"
ENV_VALIDATOR_TIMEOUT = "STUDIUM_OBS_VALIDATOR_TIMEOUT"


def _path(value: str) -> Path:
    return Path(value).expanduser().resolve()


@dataclass(frozen=True)
class ObservatoryConfig:
    """The roots to read and the address to bind.

    `courses` are course directories named one by one; they are read in addition to the
    children of `course_root`, so a course emitted anywhere can be inspected without
    moving it.
    """

    course_root: Path
    courses: tuple[Path, ...]
    eval_root: Path
    validity_root: Path
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    validator_timeout: float = DEFAULT_VALIDATOR_TIMEOUT
    #: Values that could not be parsed in `from_env`; carried into `problems()`.
    raw_problems: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "ObservatoryConfig":
        env = os.environ if env is None else env
        problems: list[str] = []

        raw_root = (env.get(ENV_COURSE_ROOT) or "").strip()
        if raw_root:
            course_root = _path(raw_root)
        else:
            course_root = next((p for p in DEFAULT_COURSE_ROOTS if p.is_dir()),
                               DEFAULT_COURSE_ROOTS[0])

        courses = tuple(_path(entry) for entry in (env.get(ENV_COURSES) or "").split(os.pathsep)
                        if entry.strip())

        raw_eval = (env.get(ENV_EVAL_ROOT) or "").strip()
        raw_validity = (env.get(ENV_VALIDITY_ROOT) or "").strip()

        port = DEFAULT_PORT
        raw_port = (env.get(ENV_PORT) or "").strip()
        if raw_port:
            try:
                port = int(raw_port)
            except ValueError:
                problems.append(f"invalid port value {raw_port!r}, using {DEFAULT_PORT}")
            else:
                if not 1 <= port <= 65535:
                    problems.append(
                        f"port out of range {raw_port!r}, using {DEFAULT_PORT}")
                    port = DEFAULT_PORT

        timeout = DEFAULT_VALIDATOR_TIMEOUT
        raw_timeout = (env.get(ENV_VALIDATOR_TIMEOUT) or "").strip()
        if raw_timeout:
            try:
                timeout = float(raw_timeout)
            except ValueError:
                problems.append(
                    f"invalid validator timeout {raw_timeout!r}, using {DEFAULT_VALIDATOR_TIMEOUT}")
            else:
                # `subprocess.run(timeout=nan)` never elapses: a non-finite or non-positive
                # value would silently remove the bound the validator adapter relies on.
                if not math.isfinite(timeout) or timeout <= 0:
                    problems.append(
                        f"validator timeout out of range {raw_timeout!r}, "
                        f"using {DEFAULT_VALIDATOR_TIMEOUT}")
                    timeout = DEFAULT_VALIDATOR_TIMEOUT

        return cls(
            course_root=course_root,
            courses=courses,
            eval_root=_path(raw_eval) if raw_eval else REPORTS_DIR,
            validity_root=_path(raw_validity) if raw_validity else EVAL_DIR / "validity",
            host=(env.get(ENV_HOST) or "").strip() or DEFAULT_HOST,
            port=port,
            validator_timeout=timeout,
            raw_problems=tuple(problems),
        )

    def problems(self) -> list[str]:
        """One line per configuration fault, in the order an operator should fix them."""
        lines = list(self.raw_problems)
        if not self.courses and not self.course_root.is_dir():
            lines.append(f"course root missing: {self.course_root}")
        lines += [f"explicit course missing: {p}" for p in self.courses if not p.is_dir()]
        if not self.eval_root.is_dir():
            lines.append(f"eval root missing: {self.eval_root}")
        if not self.validity_root.is_dir():
            lines.append(f"validity root missing: {self.validity_root}")
        return lines
