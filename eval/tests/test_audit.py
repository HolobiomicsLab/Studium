"""Unit tests for Stage 3/4 (audit + report) — built on synthetic run dirs so
they need neither the corpus nor an LLM.

Run:  /Users/holobiomicslab/git/prototype-build/.venv/bin/python -m pytest eval/tests -q
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL_DIR))

from harness.audit import heuristic_audit, run_audit  # noqa: E402
from harness.report import render_report  # noqa: E402


def _write_bundle(run_dir: Path, with_lwg: bool, grounded: bool = False) -> None:
    lwg = None
    universes = None
    if with_lwg:
        lwg = {
            "schema_version": "1.0",
            "course_id": "course-x",
            "nodes": [
                {"id": "concept:c0", "node_kind": "concept", "title": "C0", "bloom_level": "understand"},
                {"id": "concept:c1", "node_kind": "concept", "title": "C1", "bloom_level": "apply"},
            ],
            "edges": [
                {"id": "e1", "relation": "prerequisite_for", "source": "concept:c1",
                 "target": "concept:c0", "quality_flags": ["ungrounded"]},
            ],
        }
        universes = {
            "active": "baseline",
            "variants": [
                {"id": "baseline", "description": "b", "decisions": {"theta": "0.8"}},
                {"id": "remedial", "description": "r", "decisions": {"theta": "0.6"}},
            ],
        }
    bundle = {
        "schema_version": "1.4",
        "bundle_id": "bundle-x",
        "source_plan_id": "plan-x",
        "metadata": {"title": "X", "target": "L3", "duration_minutes": 20, "language": "en", "discipline": "CS"},
        "concepts": [
            {"id": "c0", "title": "C0", "description": "d", "bloom_level_target": "understand"},
            {"id": "c1", "title": "C1", "description": "d", "bloom_level_target": "apply"},
        ],
        "scenes": [
            {"id": "s1", "type": "intro", "title": "i", "objective_refs": [], "concept_refs": ["c0"],
             "estimated_seconds": 10, "adaptation_hooks": [], "markdown": "x"},
            {"id": "s2", "type": "quiz", "title": "q", "objective_refs": [], "concept_refs": ["c0"],
             "estimated_seconds": 10, "adaptation_hooks": [], "question": "?",
             "choices": [{"id": "a", "text": "a", "correct": True}, {"id": "b", "text": "b", "correct": False}],
             "feedback_correct": "ok", "feedback_incorrect": "no", "hints": []},
        ],
        "rules": [],
        "validated_by": "test-suite",
        "validated_at": "2026-06-11T00:00:00Z",
        "learning_workflow_graph": lwg,
        "universes": universes,
    }
    if grounded and with_lwg:
        bundle["learning_workflow_graph"]["edges"][0]["quality_flags"] = ["structural_inference"]
        bundle["learning_workflow_graph"]["edges"][0]["evidence"] = [
            {"doi": "10.1073/pnas.1319030111", "quote": "grounded quote", "confidence": 0.8}
        ]
        intro = next(s for s in bundle["scenes"] if s["type"] == "intro")
        intro["evidence"] = {
            "bibliographic_refs": [{
                "perspicacite_doc_id": "mock-doc-1", "doi": "10.1073/pnas.1319030111",
                "title": "A grounded source", "authors": ["Doe J"], "year": 2014,
                "excerpt": "supporting passage", "relevance_score": 0.8,
                "prov_derived_from": "test",
            }],
            "enrichment_metadata": {
                "enricher_version": "test-1.0", "perspicacite_mode_used": "passages",
                "timestamp": "2026-06-12T00:00:00Z", "degraded": False,
            },
        }
    bz = run_dir / "x-bundle.zip"
    with zipfile.ZipFile(bz, "w") as zf:
        zf.writestr("lesson.json", json.dumps(bundle))
        zf.writestr("prov.json", "{}")


def _write_persona(run_dir: Path, persona: str, transition_kinds, rules_fired, autonomy=1.0):
    sub = run_dir / "sessions" / persona
    sub.mkdir(parents=True, exist_ok=True)
    result = {
        "persona": persona,
        "learner_id": persona,
        # #4: distinct learners on one lesson get distinct salted pseudonyms — derive a per-persona
        # stand-in so the rgpd audit measures the per-learner property.
        "learner_pseudonym": f"pseudo-{persona}",
        "completed": True,
        "n_turns": len(transition_kinds),
        "transition_kinds": transition_kinds,
        "summary": {"autonomyRatio": autonomy, "scenesCompleted": 2, "totalDurationMs": 1},
        "final_concept_mastery": {"c0": 0.8},
        "final_state": {
            "lesson_id": "bundle-x",
            "concept_states": {"c0": {"alpha": 4.0, "beta": 1.0, "total_attempts": 2}},
        },
        "transcript": [],
    }
    (sub / "driver_result.json").write_text(json.dumps(result))
    tele = [{"type": "lesson_started"}]
    for r in rules_fired:
        tele.append({"type": "adaptation_applied", "rule_id": r, "modulator": "M6"})
    (sub / "telemetry.jsonl").write_text("\n".join(json.dumps(e) for e in tele))


def _provenance(run_dir: Path, mode="deterministic", offset_defect=True):
    (run_dir / "author_provenance.json").write_text(json.dumps({
        "author_mode": mode, "corpus_id": "x", "corpus_title": "X",
        "bundler_validated_at_offset_defect": offset_defect, "synthetic_assessment": True,
    }))


def test_adaptivity_full_when_branched_gated_escalated(tmp_path):
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "replay", "next", "complete"],
                   ["graph_prereq_gate", "graph_universe_escalated"])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["adaptivity"] == 1.0
    assert audit["harness_signals"]["personas_branched"] is True


def test_adaptivity_zero_and_untestable_without_lwg(tmp_path):
    _write_bundle(tmp_path, with_lwg=False)
    _provenance(tmp_path, offset_defect=False)
    _write_persona(tmp_path, "proficient", ["next", "complete"], [])
    _write_persona(tmp_path, "struggling", ["next", "complete"], [])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["adaptivity"] == 0.0
    blockers = [f for f in audit["findings"] if f["severity"] == "blocker" and f["dimension"] == "adaptivity"]
    assert blockers and blockers[0]["backlog_ref"] == "#6"


def test_ungrounded_lwg_is_flagged_to_backlog_7(tmp_path):
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "replay", "complete"], ["graph_prereq_gate"])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["grounding_citations"] < 0.5
    refs = {f["backlog_ref"] for f in audit["findings"] if f["dimension"] == "grounding_citations"}
    assert "#7" in refs


def test_grounded_bundle_scores_grounding_full(tmp_path):
    _write_bundle(tmp_path, with_lwg=True, grounded=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "replay", "complete"], ["graph_prereq_gate"])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["grounding_citations"] == 1.0
    refs = {f["backlog_ref"] for f in audit["findings"] if f["dimension"] == "grounding_citations"}
    assert "#7" not in refs


def test_autonomy_always_one_despite_replays_flagged(tmp_path):
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], [], autonomy=1.0)
    _write_persona(tmp_path, "struggling", ["next", "replay", "replay", "complete"], [], autonomy=1.0)
    audit = heuristic_audit(tmp_path)
    refs = {f["backlog_ref"] for f in audit["findings"] if f["dimension"] == "anti_offloading"}
    assert "#important-autonomy" in refs


def test_rgpd_full_when_per_learner_pseudonyms_are_distinct(tmp_path):
    # #4: two personas (= two learners) on one lesson, each with a distinct salted pseudonym.
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "replay", "complete"], ["graph_prereq_gate"])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["rgpd"] == 1.0
    rgpd = [f for f in audit["findings"] if f["dimension"] == "rgpd"]
    assert any("DISTINCT pseudonyms" in f["summary"] for f in rgpd)
    assert any("REAL erasure" in f["summary"] for f in rgpd)
    assert all(f["severity"] != "high" for f in rgpd)


def test_rgpd_flags_collision_when_pseudonyms_share(tmp_path):
    # regression guard: if the salt ever stops distinguishing learners, the audit must dock rgpd.
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    for persona in ("proficient", "struggling"):
        sub = tmp_path / "sessions" / persona
        sub.mkdir(parents=True, exist_ok=True)
        (sub / "driver_result.json").write_text(json.dumps({
            "persona": persona, "learner_id": persona,
            "learner_pseudonym": "SHARED",          # collision
            "completed": True, "n_turns": 1, "transition_kinds": ["complete"],
            "summary": {"autonomyRatio": 1.0, "scenesCompleted": 1, "totalDurationMs": 1},
            "final_concept_mastery": {}, "final_state": {"lesson_id": "bundle-x", "concept_states": {}},
            "transcript": [],
        }))
        (sub / "telemetry.jsonl").write_text(json.dumps({"type": "lesson_started"}))
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["rgpd"] < 1.0
    assert any(f["dimension"] == "rgpd" and f["severity"] == "high" for f in audit["findings"])


def test_report_renders_and_maps_backlog(tmp_path):
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "replay", "complete"],
                   ["graph_prereq_gate", "graph_universe_escalated"])
    audit = run_audit(tmp_path, use_llm=False)
    md = render_report(audit, tmp_path)
    assert "Dimension scores" in md
    assert "backlog_ref" in md or "backlog" in md
    assert (tmp_path / "audit.json").exists()


def test_remediation_via_unseen_item_scores_full(tmp_path):
    # different-item remediation emits 'remediate_alt' (never 'replay') -> #1 not flagged
    _write_bundle(tmp_path, with_lwg=True)
    _provenance(tmp_path)
    _write_persona(tmp_path, "proficient", ["next", "complete"], ["graph_prereq_gate"])
    _write_persona(tmp_path, "struggling", ["next", "remediate_alt", "next", "complete"], ["graph_prereq_gate"])
    audit = heuristic_audit(tmp_path)
    assert audit["dimension_scores"]["pedagogical_soundness"] == 1.0
    refs = {f["backlog_ref"] for f in audit["findings"] if f["dimension"] == "pedagogical_soundness"}
    assert "#1" not in refs
