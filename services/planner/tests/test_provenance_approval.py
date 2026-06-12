"""HITL course approval (critical #8 / rule-003): a human teacher reviews a
generated course and APPROVES it, flipping each indicium Claim claim_status
draft->verified and stamping the approver as `asserted_by` (prov:wasAttributedTo).
reject/hold leave draft. Anti-fabrication: verified is ONLY reachable through an
explicit approval with a non-empty approver AND a passed-in ISO timestamp (never
now()). build_course_audit_report joins LWG + evidence + ASTRA + the approval.

These tests build a fixture .lwg/<id>/ dir exactly as planner_app.py
STUDIUM_LWG_BUILD writes it (lwg.indicium.jsonld + astra.yaml + universes/*.yaml),
using the SAME serializers, so the join keys are real.
"""
from __future__ import annotations

import json

import pytest

from agentic.decision import make_decision, make_insight, make_evidence
from provenance.astra_emit import (
    emit_astra, baseline_universe, write_astra_yaml, write_universe_yaml,
)
from provenance.graph_to_indicium import graph_to_claims
from provenance.indicium_schema_vendored import assert_claim_conformant
from provenance.approval import approve_course, build_course_audit_report

_GEN_IRI = "urn:studium:graphagent:sig-101"
_TEACHER = "https://orcid.org/0000-0002-1825-0097"
_TS = "2026-06-11T09:30:00+00:00"

# An LWG with TWO prerequisite edges (one grounded w/ confidence + quality_flags,
# one weakly grounded) + one assesses edge. Mirrors GraphBuilder output shape.
_LWG = {
    "schema_version": "1.0",
    "course_id": "sig-101",
    "nodes": [
        {"id": "concept:fft", "node_kind": "concept", "title": "FFT", "bloom_level": "apply"},
        {"id": "concept:fourier", "node_kind": "concept", "title": "Fourier basics", "bloom_level": "understand"},
        {"id": "task:quiz-fft", "node_kind": "task", "title": "FFT quiz"},
    ],
    "edges": [
        {
            "id": "prereq0", "relation": "prerequisite_for",
            "source": "concept:fft", "target": "concept:fourier",
            "confidence": 0.81,
            "evidence": [{"doi": "10.1234/sig", "quote": "FFT presupposes Fourier.", "confidence": 0.81}],
            "astra_insight_ref": "sig-101-analysis/prereq0",
        },
        {
            "id": "prereq1", "relation": "prerequisite_for",
            "source": "concept:fft", "target": "concept:quiz",
            "confidence": 0.4,
            "evidence": [{"artifact": "plan:sig-101#objectives", "confidence": 0.4}],
            "astra_insight_ref": "sig-101-analysis/prereq1",
            "quality_flags": ["flagged_for_review"],
        },
        {
            "id": "assess0", "relation": "assesses",
            "source": "task:quiz-fft", "target": "concept:fft",
        },
    ],
}


def _decisions():
    return [
        make_decision(decision_id="prereq0", label="Is Fourier a prerequisite of FFT?",
                      rationale="grounded by passage",
                      options=[{"id": "include", "label": "Include"}, {"id": "omit", "label": "Omit"}],
                      default="include"),
        make_decision(decision_id="prereq1", label="Is quiz a prerequisite of FFT?",
                      rationale="weakly grounded (plan fallback)",
                      options=[{"id": "include", "label": "Include"}, {"id": "omit", "label": "Omit"}],
                      default="include"),
    ]


def _findings():
    return [
        make_insight(insight_id="prereq0", claim="FFT requires Fourier basics",
                     created_at=_TS,
                     evidence=[make_evidence(doi="10.1234/sig", quote="FFT presupposes Fourier.", confidence=0.81)]),
    ]


def _make_course_dir(tmp_path):
    """Build a .lwg/<id>/ course dir with the real serializers, returning its path."""
    course_dir = tmp_path / "sig-101"
    course_dir.mkdir(parents=True)
    doc = graph_to_claims(_LWG, asserted_by=_GEN_IRI)
    (course_dir / "lwg.indicium.jsonld").write_text(
        json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    analysis = emit_astra(
        analysis_id="sig-101-analysis", name="Signal Processing 101",
        decisions=_decisions(), prior_insights=[], findings=_findings(),
        outputs=[{"id": "lwg", "type": "data"}],
    )
    write_astra_yaml(analysis, str(course_dir))
    from provenance.universes import pedagogical_decisions, remedial_universe
    ped = pedagogical_decisions()
    write_universe_yaml(baseline_universe(ped), str(course_dir))
    write_universe_yaml(remedial_universe(ped), str(course_dir))
    return course_dir


def _claims(course_dir):
    doc = json.loads((course_dir / "lwg.indicium.jsonld").read_text())
    return [n for n in doc["@graph"] if n.get("@type") == "asb:Claim"]


# --- (a) approve flips every Claim draft->verified + stamps approver/timestamp -----
def test_approve_flips_all_claims_to_verified_and_stamps_approver(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    # precondition: every claim is draft, asserted by the generator
    pre = _claims(course_dir)
    assert pre and all(c["claim_status"] == "draft" for c in pre)
    assert all(c["asserted_by"] == _GEN_IRI for c in pre)

    rec = approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at=_TS)

    post = _claims(course_dir)
    assert all(c["claim_status"] == "verified" for c in post)
    assert all(c["asserted_by"] == _TEACHER for c in post)
    assert rec["decision"] == "approve"
    assert rec["approver"] == _TEACHER
    assert rec["approved_at"] == _TS
    assert sorted(rec["flipped_claim_ids"]) == sorted(c["id"] for c in pre)
    # original generator IRI preserved for the audit trail
    assert all(v == _GEN_IRI for v in rec["prior_assertions"].values())


def test_approved_claims_roundtrip_through_vendored_conformance(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at=_TS)
    for c in _claims(course_dir):
        assert_claim_conformant(c)  # verified is a legal enum value; no new keys added
        assert "approved_by" not in c and "approved_at" not in c and "validated_by" not in c


def test_approve_writes_approval_sidecar(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at=_TS, note="ok")
    sidecar = json.loads((course_dir / "approval.json").read_text())
    assert isinstance(sidecar, list) and len(sidecar) == 1
    assert sidecar[-1]["decision"] == "approve"
    assert sidecar[-1]["note"] == "ok"


# --- (a) reject / hold leave draft -------------------------------------------------
@pytest.mark.parametrize("decision", ["reject", "hold"])
def test_reject_and_hold_leave_claims_draft(tmp_path, decision):
    course_dir = _make_course_dir(tmp_path)
    rec = approve_course(str(course_dir), approver=_TEACHER, decision=decision, approved_at=_TS)
    post = _claims(course_dir)
    assert all(c["claim_status"] == "draft" for c in post)
    assert all(c["asserted_by"] == _GEN_IRI for c in post)  # asserted_by untouched
    assert rec["flipped_claim_ids"] == []
    # still recorded for the audit trail
    sidecar = json.loads((course_dir / "approval.json").read_text())
    assert sidecar[-1]["decision"] == decision


# --- anti-fabrication: verified impossible without approver + timestamp ------------
def test_approve_requires_nonempty_approver(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    with pytest.raises(ValueError):
        approve_course(str(course_dir), approver="", decision="approve", approved_at=_TS)
    assert all(c["claim_status"] == "draft" for c in _claims(course_dir))


def test_approve_requires_passed_in_timestamp(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    with pytest.raises(ValueError):
        approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at="")
    assert all(c["claim_status"] == "draft" for c in _claims(course_dir))


def test_unknown_decision_raises(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    with pytest.raises(ValueError):
        approve_course(str(course_dir), approver=_TEACHER, decision="bless", approved_at=_TS)


# --- (b) partial approval: only selected claims flip -------------------------------
def test_selected_claim_ids_only_flip_those(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    target = "urn:studium:edge:prereq0"
    rec = approve_course(str(course_dir), approver=_TEACHER, decision="approve",
                         approved_at=_TS, selected_claim_ids=[target])
    by_id = {c["id"]: c for c in _claims(course_dir)}
    assert by_id[target]["claim_status"] == "verified"
    assert by_id[target]["asserted_by"] == _TEACHER
    # the others remain draft + generator-asserted
    for cid, c in by_id.items():
        if cid != target:
            assert c["claim_status"] == "draft"
            assert c["asserted_by"] == _GEN_IRI
    assert rec["flipped_claim_ids"] == [target]


# --- (d) idempotent re-approve -----------------------------------------------------
def test_reapprove_is_idempotent_flips_nothing_second_time(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    rec1 = approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at=_TS)
    snapshot = (course_dir / "lwg.indicium.jsonld").read_text()
    rec2 = approve_course(str(course_dir), approver="https://orcid.org/0000-0003-0000-0000",
                          decision="approve", approved_at="2026-06-12T00:00:00+00:00")
    assert rec1["flipped_claim_ids"]  # first run flipped
    assert rec2["flipped_claim_ids"] == []  # second run flips nothing (already verified)
    # already-verified claims keep the FIRST approver (not silently overwritten)
    assert all(c["asserted_by"] == _TEACHER for c in _claims(course_dir))
    # graph bytes unchanged by the no-op re-approve
    assert (course_dir / "lwg.indicium.jsonld").read_text() == snapshot
    # but the history grows
    sidecar = json.loads((course_dir / "approval.json").read_text())
    assert len(sidecar) == 2


# --- (c) audit report joins LWG + evidence + ASTRA + approval ----------------------
def test_audit_report_pending_when_no_approval(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    json_path, md_path = build_course_audit_report(str(course_dir))
    rep = json.loads(open(json_path).read())
    assert rep["approval"]["decision"] == "pending"
    assert rep["summary"]["verified_count"] == 0
    assert rep["summary"]["draft_count"] == rep["summary"]["claim_count"]
    md = open(md_path).read()
    assert "NOT cleared for students" in md


def test_audit_report_joins_evidence_and_astra(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    json_path, _ = build_course_audit_report(str(course_dir))
    rep = json.loads(open(json_path).read())
    # claims sorted by id, deterministic
    ids = [c["id"] for c in rep["claims"]]
    assert ids == sorted(ids)
    prereq0 = next(c for c in rep["claims"] if c["id"] == "urn:studium:edge:prereq0")
    # evidence joined from the SEPIO nodes via supports_claim
    assert prereq0["evidence"], "expected joined evidence"
    ev = prereq0["evidence"][0]
    assert ev["confidence"] == 0.81
    assert ev["grounded"] is True  # citation / of_source present
    # ASTRA decision joined by edge id
    assert prereq0["astra_decision"]["label"].startswith("Is Fourier")
    assert prereq0["astra_finding"]["claim"].startswith("FFT requires")
    # universes + decisions surfaced
    assert "baseline" in rep["universes"] and "remedial" in rep["universes"]
    assert "prereq0" in rep["decisions"]


def test_audit_report_after_approval_reflects_verified(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    approve_course(str(course_dir), approver=_TEACHER, decision="approve", approved_at=_TS)
    json_path, md_path = build_course_audit_report(str(course_dir))
    rep = json.loads(open(json_path).read())
    assert rep["approval"]["decision"] == "approve"
    assert rep["approval"]["approver"] == _TEACHER
    assert rep["summary"]["verified_count"] == rep["summary"]["claim_count"]
    assert rep["summary"]["draft_count"] == 0
    md = open(md_path).read()
    assert _TEACHER in md
    assert "NOT cleared for students" not in md


def test_audit_report_is_idempotent(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    p1, p2 = build_course_audit_report(str(course_dir))
    a1, b1 = open(p1).read(), open(p2).read()
    p1b, p2b = build_course_audit_report(str(course_dir))
    assert open(p1b).read() == a1
    assert open(p2b).read() == b1


def test_audit_report_respects_out_dir(tmp_path):
    course_dir = _make_course_dir(tmp_path)
    out = tmp_path / "reports"
    out.mkdir()
    json_path, md_path = build_course_audit_report(str(course_dir), out_dir=str(out))
    assert json_path.startswith(str(out))
    assert md_path.startswith(str(out))
