#!/usr/bin/env python3
"""Exercise a real local calculation/viewer and seal its exploration evidence.

Usage: python tools/demo-grounded-exploration.py NEW_OUTPUT_DIR
Uses the existing captured-paper demo, synthetic spectra and Chrome. No web,
package installation, student submission or paid model call occurs in replay.
"""
import argparse
import json
import platform
import runpy
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from experience_exploration import prepare_exploration, seal_exploration, verify_exploration

ROOT = Path(__file__).resolve().parents[1]


def _copy_evidence(demo: Path, workspace: Path) -> list[dict]:
    entries = [("capsule/run.py", "code"), ("capsule/spectra.json", "input"),
               ("capsule/outputs/match.json", "output"), ("execution.json", "log"),
               ("audit/viewer/index.html", "code"), ("audit/viewer/viewer-provenance.json", "output"),
               ("audit/report.json", "log"), ("audit/observation.json", "output")]
    files = []
    for relative, role in entries:
        destination = workspace / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(demo / relative, destination)
        files.append({"path": relative, "role": role})
    return files


def capture_demo(demo: Path) -> dict:
    """Capture the completed demo, keeping synthetic audit text out of learner state."""
    workspace = demo / "exploration"
    context = demo / "audit/operator-context.json"
    prepare_exploration(context, workspace)
    files = _copy_evidence(demo, workspace)
    shutil.copyfile(ROOT / "examples/literature-experience/passages.json", workspace / "paper.json")
    (workspace / "environment.json").write_text(json.dumps({"python": platform.python_version(),
        "interpreter": sys.executable, "science_dependencies": "Python standard library only",
        "data_status": "synthetic illustrative spectra; not a paper replication"}, indent=2))
    files.extend([{"path": "paper.json", "role": "source"}, {"path": "environment.json", "role": "environment"}])
    record = json.loads((workspace / "experiment.json").read_text())
    record.update(question="Does precursor-aware matching establish molecular identity?",
                  hypothesis="Harness hypothesis: shifting peaks can improve a match without establishing identity.",
                  sources=[{"id": "paper", "kind": "paper", "title": "SimMS introduction excerpt",
                            "locator": "https://doi.org/10.1093/bioinformatics/btaf081",
                            "retrieved_at": "2026-09-10", "snapshot": "paper.json",
                            "selection_reason": "Explains the role of precursor mass in modified cosine."}],
                  files=files, actions=[{"status": "completed", "command": [sys.executable, "capsule/run.py"],
                      "source_ids": ["paper"], "evidence": ["capsule/outputs/match.json", "execution.json"],
                      "environment": "environment.json", "checks": [
                          {"name": "Actual fixture process exit zero", "passed": json.loads((demo / "execution.json").read_text())["exit_code"] == 0}]}],
                  learner_observation=None)
    (workspace / "experiment.json").write_text(json.dumps(record, indent=2))
    receipt = demo / "exploration-receipt"
    seal_exploration(workspace, receipt)
    report = verify_exploration(receipt, context)
    report["checked_at"] = datetime.now(timezone.utc).isoformat()
    (demo / "exploration-verification.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    """Run the existing computation/browser audit, then verify a portable receipt."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    runpy.run_path(str(ROOT / "tools/demo-literature-experience.py"))["run_demo"](args.output)
    print(json.dumps(capture_demo(args.output), indent=2))


if __name__ == "__main__":
    main()
