"""Thin CLI entry so a human teacher can run approve + report from the shell.
Verifies argument plumbing without re-testing the approval logic itself."""
from __future__ import annotations

import json

from agentic.decision import make_decision
from provenance.astra_emit import emit_astra, baseline_universe, write_astra_yaml, write_universe_yaml
from provenance.graph_to_indicium import graph_to_claims
from provenance.approval_cli import main

_TEACHER = "https://orcid.org/0000-0002-1825-0097"
_TS = "2026-06-11T09:30:00+00:00"

_LWG = {
    "schema_version": "1.0", "course_id": "sig-101", "nodes": [],
    "edges": [
        {"id": "prereq0", "relation": "prerequisite_for", "source": "concept:fft",
         "target": "concept:fourier", "confidence": 0.81,
         "evidence": [{"doi": "10.1234/sig", "confidence": 0.81}],
         "astra_insight_ref": "sig-101-analysis/prereq0"},
        {"id": "prereq1", "relation": "prerequisite_for", "source": "concept:fft",
         "target": "concept:quiz", "confidence": 0.4,
         "evidence": [{"artifact": "plan:sig-101#objectives", "confidence": 0.4}],
         "astra_insight_ref": "sig-101-analysis/prereq1"},
    ],
}


def _make_course_dir(tmp_path):
    course_dir = tmp_path / "sig-101"
    course_dir.mkdir(parents=True)
    (course_dir / "lwg.indicium.jsonld").write_text(
        json.dumps(graph_to_claims(_LWG, asserted_by="urn:studium:graphagent:sig-101"),
                   ensure_ascii=False, indent=2), encoding="utf-8")
    decisions = [make_decision(decision_id="prereq0", label="prereq0?", rationale="r",
                               options=[{"id": "include", "label": "Include"}], default="include")]
    write_astra_yaml(emit_astra(analysis_id="sig-101-analysis", name="Sig 101",
                                decisions=decisions, prior_insights=[], findings=[],
                                outputs=[]), str(course_dir))
    from provenance.universes import pedagogical_decisions
    write_universe_yaml(baseline_universe(pedagogical_decisions()), str(course_dir))
    return course_dir


def _claims(course_dir):
    doc = json.loads((course_dir / "lwg.indicium.jsonld").read_text())
    return [n for n in doc["@graph"] if n.get("@type") == "asb:Claim"]


def test_cli_approve_flips_claims(tmp_path, capsys):
    course_dir = _make_course_dir(tmp_path)
    rc = main([
        "approve", "--course-dir", str(course_dir),
        "--approver", _TEACHER, "--decision", "approve", "--approved-at", _TS,
    ])
    assert rc == 0
    assert all(c["claim_status"] == "verified" for c in _claims(course_dir))
    out = json.loads(capsys.readouterr().out)
    assert out["decision"] == "approve"


def test_cli_approve_selected_subset(tmp_path, capsys):
    course_dir = _make_course_dir(tmp_path)
    target = "urn:studium:edge:prereq0"
    rc = main([
        "approve", "--course-dir", str(course_dir),
        "--approver", _TEACHER, "--decision", "approve", "--approved-at", _TS,
        "--selected-claim-ids", target,
    ])
    assert rc == 0
    by_id = {c["id"]: c for c in _claims(course_dir)}
    assert by_id[target]["claim_status"] == "verified"
    assert by_id["urn:studium:edge:prereq1"]["claim_status"] == "draft"


def test_cli_report_writes_files(tmp_path, capsys):
    course_dir = _make_course_dir(tmp_path)
    rc = main(["report", "--course-dir", str(course_dir)])
    assert rc == 0
    assert (course_dir / "course_audit_report.json").exists()
    assert (course_dir / "course_audit_report.md").exists()
