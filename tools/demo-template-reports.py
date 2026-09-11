#!/usr/bin/env python3
"""Run five synthetic activity templates and export their local ASTRA/MySTRA reports.

Uses real host public-context/journal methods and a labelled automated browser
interaction. No teacher approval, real learner session, model call or network
retrieval is performed. Requires the repository venv, Node/tsx and local Chrome.
"""
from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
from pathlib import Path

from experience_templates import list_templates, prepare_activity
from learner_report import export_learner_report, verify_learner_report

ROOT = Path(__file__).resolve().parents[1]


def capture_synthetic_host(output: Path) -> None:
    """Capture a public context and partial journal from an isolated synthetic host."""
    script = output / "capture-host.mjs"
    module_uri = (ROOT / "packages/lesson-session-host/src/index.ts").as_uri()
    script.write_text(
        'import {SessionHost,operatorContext} from ' + json.dumps(module_uri) + ';\n'
        'import {writeFile} from "node:fs/promises";\n'
        'const host=new SessionHost({bundlesRoot:' + json.dumps(str(ROOT / "fixtures")) + ',live:false});\n'
        'const {sessionId}=await host.create("capsule-judgment-demo/lesson.json","synthetic-template-audit");\n'
        'try {\n'
        ' const context=operatorContext(host,sessionId);\n'
        ' host.recordExperiment(sessionId,{kind:"predict",experiment_id:"synthetic-export-check",'
        'authorship:"learner",consent:true,prediction:"Synthetic developer test prediction.",'
        'justification:"Checks the transport; no learning outcome is measured.",confidence:2});\n'
        ' host.recordExperiment(sessionId,{kind:"begin",experiment_id:"synthetic-export-check"});\n'
        ' for(const [name,value] of Object.entries({context,journal:host.experimentJournal(sessionId)})) '
        'await writeFile(new URL(name+".json",import.meta.url),JSON.stringify(value,null,2)+"\\n");\n'
        '} finally {host.forget(sessionId);}\n', encoding="utf-8",
    )
    env = dict(os.environ, STUDIUM_DATA_DIR="", STUDIUM_TELEMETRY_CONSENT="", LITELLM_BASE_URL="")
    completed = subprocess.run(
        [str(ROOT / "apps/lesson-mcp/node_modules/.bin/tsx"), str(script)],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=30,
    )
    (output / "host.log").write_text(completed.stdout + completed.stderr, encoding="utf-8")
    completed.check_returncode()


def run_demo(output: Path) -> Path:
    """Create a new local demo with five browser exports and verified reports."""
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    capture_synthetic_host(output)
    activities = output / "activities"
    activities.mkdir()
    ready = [item for item in list_templates()["templates"] if item["status"] == "ready"]
    for item in ready:
        prepare_activity(item["id"], output / "context.json", activities / item["id"])
    audit = output / "audit"
    completed = subprocess.run(
        ["node", str(ROOT / "tools/audit-activity-templates.mjs"), str(activities), str(audit)],
        cwd=ROOT, capture_output=True, text=True, timeout=180,
    )
    (output / "browser.log").write_text(completed.stdout + completed.stderr, encoding="utf-8")
    completed.check_returncode()
    browser_result = json.loads((audit / "report.json").read_text())
    if browser_result.get("passed") is not True:
        raise ValueError("Browser audit did not report success")
    practical_audit = output / "practical-audit"
    practical = subprocess.run(
        ["node", str(ROOT / "tools/audit-practical-templates.mjs"), str(activities), str(practical_audit)],
        cwd=ROOT, capture_output=True, text=True, timeout=180,
    )
    (output / "practical-browser.log").write_text(practical.stdout + practical.stderr, encoding="utf-8")
    practical.check_returncode()
    if json.loads((practical_audit / "report.json").read_text()).get("passed") is not True:
        raise ValueError("Practical viewer audit did not report success")
    reports = output / "reports"
    reports.mkdir()
    checks = {}
    for item in ready:
        report = export_learner_report(
            audit / f"{item['id']}-actions.json", reports / item["id"],
            activity_path=activities / item["id"] / "activity.json",
        )
        checks[item["id"]] = verify_learner_report(report)
    host_report = export_learner_report(None, reports / "host-journal", journal_path=output / "journal.json")
    checks["host-journal"] = verify_learner_report(host_report)
    report_audit = output / "report-audit"
    inspected = subprocess.run(
        ["node", str(ROOT / "tools/audit-template-reports.mjs"), str(reports), str(report_audit)],
        cwd=ROOT, capture_output=True, text=True, timeout=180,
    )
    (output / "report-browser.log").write_text(inspected.stdout + inspected.stderr, encoding="utf-8")
    inspected.check_returncode()
    if json.loads((report_audit / "report.json").read_text()).get("passed") is not True:
        raise ValueError("Report viewer audit did not report success")
    evidence = {
        "purpose": "synthetic developer demonstration; no measured learning",
        "browser_audit": "audit/report.json", "practical_audit": "practical-audit/report.json", "report_viewer_audit": "report-audit/report.json", "reports": checks,
        "host_journal": "separate synthetic transport check, not browser chronology",
        "teaching_model_calls": 0, "student_release": "not performed",
    }
    (output / "demo.json").write_text(json.dumps(evidence, indent=2) + "\n")
    rows = "".join(
        f'<article class="card"><h2>{html.escape(item["title"])}</h2><p>{html.escape(item["learning_goal"])}</p>'
        f'<p><a href="activities/{item["id"]}/index.html">Ouvrir l’activité</a> · '
        f'<a href="reports/{item["id"]}/index.html">Rapport MySTRA de test</a></p></article>' for item in ready
    )
    (output / "index.html").write_text(
        '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Studium · Activités et rapports</title><style>' +
        (ROOT / "ui/studium-theme.css").read_text(encoding="utf-8") +
        '</style><body class="studium-viewer"><header><span class="brand">STUDIUM</span>'
        '<span class="meta">Atelier des viewers · démonstration technique</span></header><main>'
        '<span class="eyebrow">Activités et rapports</span><h1>Explorer, observer, relire.</h1>'
        '<p class="notice">Démonstration technique synthétique. Les rapports ont été produits par un audit navigateur automatisé ; '
        'ils ne décrivent pas un étudiant réel. Le viewer ne contient pas un agent.</p>' + rows +
        '<p>Les cinq activités partagent le même parcours et les mêmes formats de trace et de rapport.</p>'
        '<p><a href="reports/host-journal/index.html">Rapport du journal moteur synthétique</a> · '
        '<a href="demo.json">Vérifications</a></p><p>ASTRA, ARA et MySTRA communs ; export local, textes exclus par défaut. '
        'Aucune évaluation d’apprentissage ni diffusion étudiante.</p></main></body></html>', encoding="utf-8",
    )
    return output


def main() -> None:
    """Run the demonstration in a new output directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(run_demo(args.output))


if __name__ == "__main__":
    main()
