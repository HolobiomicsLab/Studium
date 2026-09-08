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
from class_report import MIN_LEARNERS_DEFAULT  # noqa: E402  (one definition of the k floor)

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
#: The collector's event store, as an ABSOLUTE path. The collector resolves its own
#: `ANALYTICS_DATA_DIR` (default `"data"`) against *its* working directory, and the teacher
#: guide starts it after a `cd`, so the same string names two directories depending on where
#: each process was started. The Observatory therefore takes its own variable, resolves it,
#: and echoes the result on the index: a divergence has to be visible, not silent.
#: There is deliberately no course-token variable — the collector's check is string equality
#: between the `X-Course-Token` header and the `course` query parameter, so the token *is* the
#: course id, typed into the teacher dashboard and rendered on screen (INT-STUDIUM-019).
ENV_ANALYTICS_DATA_DIR = "STUDIUM_OBS_ANALYTICS_DATA_DIR"
#: ONE directory of telemetry streams, read whole by `class_report.build_report`, which
#: discovers its input with `rglob("telemetry.jsonl")`. Deliberately NOT course-scoped:
#: the durable MCP-host tree is keyed by pseudonym (`<pseudonym>/<bundle_id>/`) and an
#: eval run's by persona, so neither writer has a course dimension and a `<root>/<course>`
#: convention would name a layout nothing on disk produces.
ENV_SESSIONS_ROOT = "STUDIUM_OBS_SESSIONS_ROOT"


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
    #: The collector's store, absolute; `None` when the operator has not named one, in which
    #: case the Observatory reads no live column rather than guessing a relative directory.
    analytics_data_dir: Path | None = None
    #: The directory `build_report` reads whole; `None` when the operator has not named
    #: one, in which case the session-runs column is absent rather than guessed.
    sessions_root: Path | None = None
    #: The floor applied to every learner-derived number, imported from `tools/class_report.py`
    #: so the value has one definition (INT-STUDIUM-005). For this deployment's reader — a
    #: teacher who already holds the roster — it restrains singling out rather than delivering
    #: anonymity (INT-STUDIUM-030).
    min_learners: int = MIN_LEARNERS_DEFAULT
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
        raw_analytics = (env.get(ENV_ANALYTICS_DATA_DIR) or "").strip()
        raw_sessions = (env.get(ENV_SESSIONS_ROOT) or "").strip()

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
            analytics_data_dir=_path(raw_analytics) if raw_analytics else None,
            sessions_root=_path(raw_sessions) if raw_sessions else None,
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
        if self.analytics_data_dir is not None and not self.analytics_data_dir.is_dir():
            lines.append(f"analytics store missing: {self.analytics_data_dir}")
        if self.sessions_root is not None and not self.sessions_root.is_dir():
            lines.append(f"sessions root missing: {self.sessions_root}")
        return lines

    def notes(self) -> list[str]:
        """Configuration an operator must be able to read off the page, fault or not.

        The analytics store is the one value two processes can disagree about in silence,
        so it is stated as resolved rather than as typed. The session root is stated the
        same way, and as one directory: it is read whole, by a different reader, and only
        the collector's half of the pair is partitioned by course.
        """
        if self.analytics_data_dir is None:
            lines = [f"analytics store: not configured — set {ENV_ANALYTICS_DATA_DIR} to the "
                     f"absolute directory the collector writes (its own ANALYTICS_DATA_DIR "
                     f'defaults to the relative "data", resolved against the collector\'s '
                     f"working directory, not this one)."]
        else:
            lines = [f"analytics store: {self.analytics_data_dir} "
                     f"(k-anonymity floor: {self.min_learners} learners)"]
        if self.sessions_root is None:
            lines.append(f"session runs: not configured ({ENV_SESSIONS_ROOT})")
        else:
            lines.append(f"session runs: {self.sessions_root} (one directory, read whole)")
        return lines
