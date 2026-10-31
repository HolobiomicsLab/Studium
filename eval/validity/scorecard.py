"""scorecard.py — one aggregate scorecard for a single, IDENTIFIED validity run.

INT-STUDIUM-002. The five validity tools each write their own report, and each report is
correct. What the repository could not produce was a single artifact saying *which run* a
published claim rests on: the reports live in gitignored directories, they are named under
three different schemes, and two of them (`grounding_relevance`, `bea_tutor`) name the file
after the BUNDLE — `05-bundle.json` — so the next course-05 run silently overwrites the numbers
a paragraph was written from. A ledger entry with no run identifier is not a weaker citation
than one with a bad identifier; it is an unfalsifiable one.

So this module writes ONE file, at a fixed committed path, the way
`bea_external/external_result.json` is committed. It carries:

* the run id and the commit the code was at, so a sentence can name both;
* per tool, the report it read, that report's **sha256**, and whether the report's own
  `run_dir` / `bundle` field actually points at this run. The digest is the part that matters
  for the two overwritten filenames: a later reader can tell whether the file still holds the
  numbers quoted here, instead of assuming it does;
* aggregate numbers only.

It does not decide anything. A tool that flagged is recorded as flagged, and a tool whose
report could not be attributed to this run is recorded as unattributed rather than quietly
matched by filename.

RGPD. Run directories carry per-learner state (`final_concept_mastery`, transcripts, telemetry
keyed by `learner_pseudonym`), which is why `eval/reports/` is gitignored. This file is
committed, so `assert_no_learner_data` runs before every write and refuses on a forbidden key
or on a value shaped like a pseudonym. The extraction below is explicit, field by field; the
guard exists for the extractor somebody writes next.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "studium-validity-scorecard/1"

#: Tool name -> directory under `eval/validity/` holding its `reports/`.
TOOLS = ("kt_calibration", "persona_validation", "grounding_relevance",
         "bea_tutor", "reasoning_depth")

#: kt_calibration validates the learner model against an external dataset (ASSISTments), not
#: against an eval run. Attributing its report to a run id would be a false precision — it
#: would still be the same number for a different run.
RUN_INDEPENDENT = ("kt_calibration",)

#: Keys that carry, or contain, per-learner records. Denied outright rather than filtered:
#: a scorecard that silently dropped the learner half of a structure would still have been
#: built from an extractor that thought copying it was in bounds.
FORBIDDEN_KEYS = frozenset({
    "learner_pseudonym", "learner_id", "pseudonym", "pseudonyme", "transcript", "transcripts",
    "sessions", "cards", "evidenced_scenes", "irrelevant_scenes", "final_concept_mastery",
    "final_state", "transitions", "events",
})

#: `learner_pseudonym` is a 16-hex digest (`ac2a5eaa830e189c`). Checked as an exact shape so a
#: sha256 (64 hex) does not trip it — the digests below are the point of the file.
_PSEUDONYM = re.compile(r"^[0-9a-f]{16}$")


class LearnerDataError(ValueError):
    """A scorecard about to be committed contained per-learner data."""


def assert_no_learner_data(obj: object, path: str = "$") -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if str(k).lower() in FORBIDDEN_KEYS:
                raise LearnerDataError(f"{path}.{k}: forbidden key for a committed scorecard")
            assert_no_learner_data(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            assert_no_learner_data(v, f"{path}[{i}]")
    elif isinstance(obj, str) and _PSEUDONYM.match(obj):
        raise LearnerDataError(f"{path}: value is shaped like a learner pseudonym")


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _attributes_to(report: dict, run_id: str) -> bool:
    """Does the report say, itself, that it is about this run?

    `persona_validation` and `reasoning_depth` record `run_dir`; `grounding_relevance` and
    `bea_tutor` record the `bundle` path, which contains the run id. Nothing is inferred from
    the report's FILENAME, because two of the four filenames do not carry a run id at all.
    """
    for key in ("run_dir", "bundle"):
        value = report.get(key)
        if isinstance(value, str) and run_id in value:
            return True
    return False


def locate(tool: str, validity_dir: Path, run_id: str) -> tuple[Path | None, dict | None]:
    """The report this tool wrote for this run, read from its CONTENT.

    Returns `(None, None)` when no report in the directory claims this run — which is the
    honest outcome for a tool that did not run, or whose file has since been overwritten by a
    later run of the same course.
    """
    reports = validity_dir / tool / "reports"
    if not reports.is_dir():
        return None, None
    candidates = sorted(reports.glob("*.json"))
    if tool in RUN_INDEPENDENT:
        # Newest by mtime: there is no run to match on, and the suite just ran it.
        newest = max(candidates, key=lambda p: p.stat().st_mtime, default=None)
        return (newest, json.loads(newest.read_text())) if newest else (None, None)
    for p in candidates:
        try:
            data = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict) and _attributes_to(data, run_id):
            return p, data
    return None, None


def _headline(tool: str, r: dict) -> dict:
    """The aggregate numbers, named field by field. Never a whole sub-structure."""
    if tool == "kt_calibration":
        return {
            "source_type": r.get("source", {}).get("type"),
            "n_observations": r.get("source", {}).get("n"),
            "beta_beats_running_mean": r.get("beta_beats_running_mean"),
            "results": {k: {m: v.get(m) for m in ("auc", "brier", "acc", "n")}
                        for k, v in (r.get("results") or {}).items()},
        }
    if tool == "persona_validation":
        personas = r.get("personas") or {}
        return {
            "verdict": r.get("verdict"),
            "n_personas": len(personas),
            # Persona names are SCRIPTS, not people: `hint_reliant` is a policy in
            # `eval/harness/personas.mjs`. This is the claim §8 rests on, so it is recorded
            # per persona and not as a count that hides which one failed.
            "completed": {name: bool(p.get("completed")) for name, p in personas.items()},
            "n_turns": {name: p.get("n_turns") for name, p in personas.items()},
            "max_collapse_score": (r.get("divergence") or {}).get("max_collapse_score"),
            "missing_branches": (r.get("branch_coverage") or {}).get("missing"),
            "findings": r.get("findings"),
        }
    if tool == "grounding_relevance":
        return {
            "verdict": r.get("verdict"),
            "n_evidenced_scenes": r.get("n_evidenced_scenes"),
            "mean_best_relevance": r.get("mean_best_relevance"),
            "relevance_grade": r.get("relevance_grade"),
            "threshold": r.get("threshold"),
        }
    if tool == "bea_tutor":
        return {k: r.get(k) for k in
                ("n_moves", "reveal_rate", "actionability_rate", "summative_safe_rate")}
    if tool == "reasoning_depth":
        traj, cont = r.get("trajectory") or {}, r.get("contingency") or {}
        return {
            "verdict": r.get("verdict"),
            "n_signals": traj.get("n_signals"),
            "depth_slope": traj.get("depth_slope"),
            "signal_entropy": traj.get("signal_entropy"),
            "n_moves": cont.get("n_moves"),
            "reveal_violations": cont.get("reveal_violations"),
        }
    return {}


def git_commit(repo: Path) -> str | None:
    """The commit the tools ran at. A run id without one names the data and not the code."""
    try:
        out = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() or None


def build(run_dir: str, validity_dir: Path, repo: Path,
          exit_codes: dict[str, int] | None = None) -> dict:
    run_id = Path(run_dir).name
    corpus, _, rest = run_id.partition("-")
    author_mode = rest.split("-")[0] if rest else None
    exit_codes = exit_codes or {}

    tools: dict[str, dict] = {}
    for tool in TOOLS:
        path, report = locate(tool, validity_dir, run_id)
        entry: dict = {"exit_code": exit_codes.get(tool)}
        if path is None or report is None:
            entry.update(status="missing", source_report=None, source_sha256=None,
                         attributed_to_run=False, headline={})
            entry["note"] = ("no report in this tool's directory claims this run — it did not "
                             "run, or its file was overwritten by a later run")
        else:
            code = exit_codes.get(tool)
            entry.update(
                status=("ok" if code == 0 else "flagged" if code == 1 else
                        "error" if code is not None else "read"),
                source_report=str(path.relative_to(repo)),
                source_sha256=sha256(path),
                attributed_to_run=(None if tool in RUN_INDEPENDENT
                                   else _attributes_to(report, run_id)),
                headline=_headline(tool, report),
            )
            if tool in RUN_INDEPENDENT:
                entry["note"] = ("validates the learner model against an external dataset, not "
                                 "against this run: the same number for any run id")
        tools[tool] = entry

    card = {
        "schema": SCHEMA,
        "run_id": run_id,
        "run_dir": run_dir,
        "corpus": corpus or None,
        "author_mode": author_mode,
        "git_commit": git_commit(repo),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tools": tools,
        "learner_data": ("none — aggregates only; the run directory that produced these numbers "
                         "is gitignored and stays local"),
    }
    assert_no_learner_data(card)
    return card


def render_md(card: dict) -> str:
    lines = [
        "# Validity scorecard",
        "",
        f"- **run id**: `{card['run_id']}`",
        f"- **author mode**: {card.get('author_mode')}  ·  **corpus**: {card.get('corpus')}",
        f"- **code**: `{(card.get('git_commit') or 'unknown')[:12]}`",
        f"- **generated**: {card.get('generated_at')}",
        "",
        "The run directory itself is gitignored (it carries per-learner state). This file is the",
        "committed record: it names the run, the code, and the digest of every report it read.",
        "",
        "| tool | status | attributed to this run | source report | sha256 |",
        "|---|:-:|:-:|---|---|",
    ]
    for name, t in card["tools"].items():
        att = {True: "yes", False: "**no**", None: "n/a"}[t.get("attributed_to_run")]
        src = f"`{t['source_report']}`" if t.get("source_report") else "—"
        digest = f"`{t['source_sha256'][:12]}`" if t.get("source_sha256") else "—"
        lines.append(f"| {name} | {t.get('status')} | {att} | {src} | {digest} |")
    lines += ["", "## Headline numbers", ""]
    for name, t in card["tools"].items():
        lines.append(f"### {name}")
        if t.get("note"):
            lines.append(f"> {t['note']}")
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(t.get("headline", {}), indent=2, ensure_ascii=False))
        lines.append("```")
        lines.append("")
    return "\n".join(lines) + "\n"


def write(card: dict, json_path: Path, md_path: Path | None = None) -> None:
    assert_no_learner_data(card)
    json_path.write_text(json.dumps(card, indent=2, ensure_ascii=False) + "\n")
    if md_path is not None:
        md_path.write_text(render_md(card))
