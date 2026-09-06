"""Read-only views over the evaluation runs and validity suites on disk (INT-STUDIUM-008).

Nothing here opens a network connection, starts a run or writes a file. Two rules
carry the spec's privacy constraint N1 into every view:

* `FORBIDDEN_KEYS` is stripped from every blob copied out of an artifact, so a key
  added upstream cannot reach a template through a generic key/value fold-out;
* the per-learner files are read field by field. `sessions/<persona>/events.jsonl`
  is never opened at all, and `driver_result.json` yields only its counters.

The persona turn cap comes from `harness.runner.DEFAULT_MAX_TURNS`, the number the
session driver itself enforced, rather than a literal re-declared here (R9).
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from observatory_discovery import RunRef, SuiteRef, parse_run_dirname
from observatory_paths import ensure_importable

ensure_importable()

from harness.runner import DEFAULT_MAX_TURNS  # noqa: E402

#: Never copied into a view, at any depth, whatever the artifact holds.
FORBIDDEN_KEYS = frozenset(
    {"transcript", "learner_pseudonym", "pseudonym", "pseudonyme", "learner_id",
     "text", "payload", "final_state"}
)

#: The only `audit.json` persona-signal keys a view may carry (allow-list).
PERSONA_SIGNAL_KEYS = (
    "completed", "n_turns", "transition_kinds", "autonomyRatio", "adaptation_rules_fired",
)

AUDIT_FILE = "audit.json"
DRIVER_FILE = "driver_result.json"
TELEMETRY_FILE = "telemetry.jsonl"
REPORT_FILE = "report.md"
NO_RESULT = "no result file"

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class PersonaSummary:
    """One persona session of one run. Synthetic: personas are scripted, not people."""

    name: str
    turns: int | None = None
    completed: bool | None = None
    degraded_turns: int | None = None
    cap_hit: bool | None = None
    transition_kinds: dict[str, int] = field(default_factory=dict)
    event_types: dict[str, int] = field(default_factory=dict)
    first_at: str | None = None
    last_at: str | None = None
    unreadable: tuple[str, ...] = ()


@dataclass(frozen=True)
class RunSummary:
    """One evaluation run directory, read from `audit.json` when it parses."""

    id: str
    path: str
    corpus_id: str | None = None
    author_mode: str | None = None
    timestamp: str | None = None
    auditor: str | None = None
    overall_score: float | None = None
    n_findings: int | None = None
    personas: tuple[PersonaSummary, ...] = ()
    parsed_from: str = "dirname"
    unreadable: dict[str, str] = field(default_factory=dict)


def scalars_of(obj: Any) -> dict[str, object]:
    """Flatten one level of a result document: scalars kept, containers described."""
    if not isinstance(obj, Mapping):
        return {"value": _describe(obj)}
    return {str(k): _describe(v) for k, v in obj.items()}


def summarize_run(ref: RunRef, *, max_turns: int = DEFAULT_MAX_TURNS) -> RunSummary:
    """The index row for one run: identity, audit headline, one line per persona."""
    audit, problem = _read_json(ref.path / AUDIT_FILE)
    parsed = parse_run_dirname(ref.id)
    unreadable: dict[str, str] = {} if problem is None else {AUDIT_FILE: problem}

    if isinstance(audit, Mapping):
        findings = audit.get("findings")
        summary = RunSummary(
            id=ref.id,
            path=str(ref.path),
            corpus_id=_text(audit.get("corpus_id")) or parsed["corpus_id"],
            author_mode=_text(audit.get("author_mode")) or parsed["author_mode"],
            timestamp=parsed["timestamp"],
            auditor=_text(audit.get("auditor")),
            overall_score=_number(audit.get("overall_score")),
            n_findings=len(findings) if isinstance(findings, Sequence) and not isinstance(findings, str) else None,
            parsed_from=AUDIT_FILE,
            unreadable=unreadable,
        )
    else:
        summary = RunSummary(
            id=ref.id,
            path=str(ref.path),
            corpus_id=parsed["corpus_id"],
            author_mode=parsed["author_mode"],
            timestamp=parsed["timestamp"],
            parsed_from="dirname",
            unreadable=unreadable,
        )

    signals = audit.get("persona_signals") if isinstance(audit, Mapping) else None
    personas = _personas(ref.path, signals if isinstance(signals, Mapping) else {}, max_turns)
    return RunSummary(**{**asdict(summary), "personas": personas})


def run_detail(ref: RunRef, *, max_turns: int = DEFAULT_MAX_TURNS) -> dict:
    """Everything the run page shows. Scores, findings and signals are scrubbed copies."""
    summary = summarize_run(ref, max_turns=max_turns)
    audit, _ = _read_json(ref.path / AUDIT_FILE)
    audit = audit if isinstance(audit, Mapping) else {}

    report_md, report_problem = _read_text(ref.path / REPORT_FILE)
    unreadable = dict(summary.unreadable)
    if report_problem is not None and report_problem != "missing":
        # An absent report is ordinary and the page says so in words; a report that
        # cannot be decoded is a gap the page has to name.
        unreadable[REPORT_FILE] = report_problem

    findings = audit.get("findings")
    signals = audit.get("persona_signals")
    detail = asdict(summary)
    detail.update(
        dimension_scores=_scrub(audit.get("dimension_scores")) if isinstance(audit.get("dimension_scores"), Mapping) else {},
        findings=_scrub(findings) if isinstance(findings, Sequence) and not isinstance(findings, str) else [],
        harness_signals=_scrub(audit.get("harness_signals")) if isinstance(audit.get("harness_signals"), Mapping) else {},
        persona_signals=_persona_signals(signals if isinstance(signals, Mapping) else {}),
        report_md=report_md,
        unreadable=unreadable,
        has_author_provenance=(ref.path / "author_provenance.json").is_file(),
        has_refinement_feedback=(ref.path / "refinement_feedback.json").is_file(),
    )
    return detail


def summarize_suite(ref: SuiteRef) -> dict:
    """One validity suite: its README title and the scalars of every result document."""
    results: list[dict] = []
    for path in _result_files(ref.path):
        rel = path.relative_to(ref.path).as_posix()
        payload, problem = _read_json(path)
        if problem is not None:
            results.append({"file": rel, "error": problem})
            continue
        results.append({"file": rel, "mtime": _iso_mtime(path), "scalars": scalars_of(payload)})

    view = {"name": ref.name, "title": _title(ref.path / "README.md", ref.name), "results": results}
    if not results:
        view["reason"] = NO_RESULT
    return view


def _personas(run_dir: Path, signals: Mapping, max_turns: int) -> tuple[PersonaSummary, ...]:
    sessions = run_dir / "sessions"
    if not sessions.is_dir():
        return ()
    return tuple(
        _persona(sub, signals.get(sub.name), max_turns)
        for sub in sorted(p for p in sessions.iterdir() if p.is_dir())
    )


def _persona(session_dir: Path, signal: object, max_turns: int) -> PersonaSummary:
    problems: list[str] = []
    result, problem = _read_json(session_dir / DRIVER_FILE)
    if problem is not None:
        problems.append(f"{DRIVER_FILE}: {problem}")
    result = result if isinstance(result, Mapping) else {}
    fallback = signal if isinstance(signal, Mapping) else {}

    turns = _int(result.get("n_turns"))
    if turns is None:
        turns = _int(fallback.get("n_turns"))
    completed = result.get("completed")
    if not isinstance(completed, bool):
        completed = fallback.get("completed") if isinstance(fallback.get("completed"), bool) else None

    kinds = result.get("transition_kinds")
    if kinds is None:
        kinds = fallback.get("transition_kinds")

    events, first_at, last_at, telemetry_problem = _telemetry(session_dir / TELEMETRY_FILE)
    if telemetry_problem is not None:
        problems.append(f"{TELEMETRY_FILE}: {telemetry_problem}")

    return PersonaSummary(
        name=session_dir.name,
        turns=turns,
        completed=completed,
        degraded_turns=_int(result.get("degraded_turns")),
        cap_hit=None if turns is None else turns >= max_turns,
        transition_kinds=_histogram(kinds),
        event_types=events,
        first_at=first_at,
        last_at=last_at,
        unreadable=tuple(problems),
    )


def _telemetry(path: Path) -> tuple[dict[str, int], str | None, str | None, str | None]:
    """The event-type histogram and the time span. Only `type` and `client_timestamp`
    are read; every other field of an event stays on disk."""
    if not path.is_file():
        return {}, None, None, None if not path.parent.is_dir() else "missing"

    counts: Counter[str] = Counter()
    stamps: list[str] = []
    problem: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, ValueError) as exc:  # unreadable, or not UTF-8
        return {}, None, None, _problem(exc)

    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except ValueError:
            problem = problem or f"unreadable: line {number}"
            continue
        if not isinstance(event, Mapping):
            continue
        kind = _text(event.get("type"))
        if kind:
            counts[kind] += 1
        stamp = _text(event.get("client_timestamp"))
        if stamp:
            stamps.append(stamp)

    return dict(counts), (stamps[0] if stamps else None), (stamps[-1] if stamps else None), problem


def _persona_signals(signals: Mapping) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for name, signal in signals.items():
        if not isinstance(signal, Mapping):
            continue
        out[str(name)] = {k: _scrub(signal[k]) for k in PERSONA_SIGNAL_KEYS if k in signal}
    return out


def _result_files(suite_dir: Path) -> list[Path]:
    if not suite_dir.is_dir():
        return []
    files = sorted(p for p in suite_dir.glob("*.json") if p.is_file())
    reports = suite_dir / "reports"
    if reports.is_dir():
        files += sorted(p for p in reports.glob("*.json") if p.is_file())
    return files


def _title(readme: Path, fallback: str) -> str:
    text, _ = _read_text(readme)
    for line in (text or "").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def _scrub(value: Any) -> Any:
    """A deep copy without any forbidden key, whatever the artifact grows upstream."""
    if isinstance(value, Mapping):
        return {str(k): _scrub(v) for k, v in value.items() if str(k) not in FORBIDDEN_KEYS}
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    return value


def _describe(value: Any) -> object:
    if isinstance(value, Mapping):
        return f"<dict, {len(value)} keys>"
    if isinstance(value, (list, tuple)):
        return f"<list, {len(value)} items>"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _histogram(value: Any) -> dict[str, int]:
    """`driver_result.json` writes a list of transition kinds, `audit.json` a histogram."""
    if isinstance(value, Mapping):
        return {str(k): int(v) for k, v in value.items() if isinstance(v, int) and not isinstance(v, bool)}
    if isinstance(value, (list, tuple)):
        return dict(Counter(str(item) for item in value))
    return {}


def _read_json(path: Path) -> tuple[Any, str | None]:
    if not path.is_file():
        return None, "missing"
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except (OSError, ValueError) as exc:
        return None, _problem(exc)


def _read_text(path: Path) -> tuple[str | None, str | None]:
    """(text, problem), the shape of `_read_json`.

    A report or a README written in another encoding raises `UnicodeDecodeError`, a
    `ValueError`, not an `OSError`: catching only the latter turned one such file into
    a 500 on the run page and, through `_title`, on the index (spec constraint N3).
    """
    if not path.is_file():
        return None, "missing"
    try:
        return path.read_text(encoding="utf-8"), None
    except (OSError, ValueError) as exc:
        return None, _problem(exc)


def _iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(timespec="seconds")


def _problem(exc: Exception) -> str:
    """See `astra_read._unreadable`: the type reaches the page, the message the log."""
    LOGGER.warning("unreadable evaluation artifact: %s: %s", type(exc).__name__, exc)
    return f"unreadable: {type(exc).__name__}"


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _int(value: Any) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None
