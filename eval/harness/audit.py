"""Stage 3 — AUDIT: score the generated course + the run, emit structured feedback.

Two layers, both emitting the SAME audit.json shape:

  - HEURISTIC AUDITOR (default, key-free): pure-Python. Reads the bundle, the
    author_provenance, and every persona's telemetry/summary, computes objective
    signals (did decisions branch across personas? did prereq-gating /
    escalation fire? was mastery earned via distinct items + min attempts? is the
    LWG grounded? is RGPD pseudonymisation per-learner?), scores 6 rubric
    dimensions, and attaches findings each carrying a `backlog_ref` into
    REVIEW-FINDINGS.md so the report doubles as the loop's regression signal.

  - CLAUDE AUDITOR (optional, --audit-llm): feeds the same dossier to the
    `claude` CLI for a pedagogical-soundness narrative + extra findings, MERGED
    onto the heuristic result (never replacing the objective signals).

The auditor is offline-capable: it reads artifacts, not live calls. This is the
"auditing studio" of the design.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .llm import ClaudeCli, claude_available

# Severity ordering for sorting / gating.
SEVERITY_ORDER = {"blocker": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Finding:
    dimension: str
    severity: str
    summary: str
    evidence_path: str
    backlog_ref: str

    def as_dict(self) -> dict:
        return {
            "dimension": self.dimension,
            "severity": self.severity,
            "summary": self.summary,
            "evidence_path": self.evidence_path,
            "backlog_ref": self.backlog_ref,
        }


@dataclass
class PersonaRun:
    persona: str
    result: dict  # driver_result.json
    telemetry: list[dict] = field(default_factory=list)

    @property
    def adaptation_rules(self) -> list[str]:
        return [e.get("rule_id") for e in self.telemetry if e.get("type") == "adaptation_applied"]

    def count_event(self, etype: str) -> int:
        return sum(1 for e in self.telemetry if e.get("type") == etype)

    def count_rule(self, rule_id: str) -> int:
        return sum(1 for e in self.telemetry if e.get("rule_id") == rule_id)


def _load_persona_runs(sessions_dir: Path) -> list[PersonaRun]:
    runs: list[PersonaRun] = []
    if not sessions_dir.exists():
        return runs
    for sub in sorted(sessions_dir.iterdir()):
        if not sub.is_dir():
            continue
        rfile = sub / "driver_result.json"
        if not rfile.exists():
            continue
        result = json.loads(rfile.read_text(encoding="utf-8"))
        tfile = sub / "telemetry.jsonl"
        telemetry = []
        if tfile.exists():
            for line in tfile.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    telemetry.append(json.loads(line))
        runs.append(PersonaRun(persona=sub.name, result=result, telemetry=telemetry))
    return runs


# ---------------------------------------------------------------------------
# Rubric dimensions (heuristic scoring)
# ---------------------------------------------------------------------------


def _score_pedagogical_soundness(bundle: dict, runs: list[PersonaRun], findings: list[Finding]) -> float:
    score = 1.0
    blooms = [c.get("bloom_level_target") for c in bundle.get("concepts", [])]
    ladder = ["remember", "understand", "apply", "analyze", "evaluate", "create"]
    idxs = [ladder.index(b) for b in blooms if b in ladder]
    if idxs and idxs != sorted(idxs):
        score -= 0.2
        findings.append(Finding("pedagogical_soundness", "low",
            "Bloom targets across concepts are not monotonically non-decreasing.",
            "bundle:concepts[].bloom_level_target", "M1-bloom-progression"))
    # same-item remediation (#1): replays of the SAME scene id rather than a different item.
    replay_streaks = 0
    for r in runs:
        kinds = r.result.get("transition_kinds", [])
        replay_streaks += sum(1 for k in kinds if k == "replay")
    if replay_streaks > 0:
        score -= 0.25
        findings.append(Finding("pedagogical_soundness", "high",
            f"Remediation replays the SAME scene ({replay_streaks} replay transitions across personas) "
            "rather than presenting a DIFFERENT item — same-item remediation.",
            "sessions/*/driver_result.json:transition_kinds", "#1"))
    # difficulty never modulates by Bloom (M1): quiz difficulty is a fixed 0.5 in graders.
    findings.append(Finding("pedagogical_soundness", "info",
        "Quiz difficulty is fixed (graders.ts DIFFICULTY.quiz=0.5); Bloom level does not modulate it.",
        "packages/lesson-session/src/grading/graders.ts", "M1-bloom-difficulty"))
    return max(0.0, score)


def _score_grounding(bundle: dict, prov: dict, findings: list[Finding]) -> float:
    lwg = bundle.get("learning_workflow_graph") or {}
    edges = lwg.get("edges", [])
    ungrounded = [e for e in edges if "ungrounded" in (e.get("quality_flags") or []) or not e.get("evidence")]
    score = 1.0
    if edges and len(ungrounded) == len(edges):
        score = 0.3
        findings.append(Finding("grounding_citations", "high",
            f"All {len(edges)} LWG edges are ungrounded (structural inference, no citable Perspicacité "
            "passage / evidence). Mirrors the planner _ARTIFACT_FALLBACK_CONF=0.4 fallback.",
            "bundle:learning_workflow_graph.edges", "#7"))
    # concept evidence (ADR 014): are concept scenes carrying bibliographic_refs?
    concept_scenes = [s for s in bundle.get("scenes", []) if s.get("type") in ("intro", "concept")]
    with_ev = [s for s in concept_scenes if s.get("evidence")]
    if concept_scenes and not with_ev:
        score = min(score, 0.4)
        findings.append(Finding("grounding_citations", "medium",
            "No concept/intro scene carries an evidence block (EvidenceEnricher OFF / Perspicacité "
            "unreachable). Concepts are ungrounded.",
            "bundle:scenes[type in intro,concept].evidence", "#7"))
    if prov.get("author_mode") == "deterministic":
        findings.append(Finding("grounding_citations", "info",
            "Offline deterministic author: prose lifted verbatim from corpus sections (section-faithful) "
            "but not citation-grounded; quiz items are synthetic.",
            "author_provenance.json", "#1-author-mode"))
    return score


def _score_adaptivity(runs: list[PersonaRun], bundle: dict, findings: list[Finding]) -> float:
    has_lwg = bool(bundle.get("learning_workflow_graph"))
    has_universes = bool(bundle.get("universes"))
    if not has_lwg or not has_universes:
        findings.append(Finding("adaptivity", "blocker",
            "Bundle lacks an LWG and/or universes — adaptivity (prereq-gating, escalation) is UNTESTABLE.",
            "bundle:learning_workflow_graph / universes", "#6"))
        return 0.0
    # Did decisions actually BRANCH across personas? diff transition_kinds.
    sigs = {r.persona: tuple(r.result.get("transition_kinds", [])) for r in runs}
    distinct = len(set(sigs.values()))
    branched = distinct > 1
    prereq_fired = any(r.count_rule("graph_prereq_gate") > 0 for r in runs)
    escalated = any(r.count_rule("graph_universe_escalated") > 0 for r in runs)
    score = 0.0
    if branched:
        score += 0.4
    else:
        findings.append(Finding("adaptivity", "high",
            "All personas produced IDENTICAL transition sequences — decisions did not branch "
            "(the 'every chosen=include' / binary-admission defect).",
            "sessions/*/driver_result.json:transition_kinds", "#important-agentic-branching"))
    if prereq_fired:
        score += 0.3
    else:
        findings.append(Finding("adaptivity", "high",
            "LWG present but graph_prereq_gate never fired — prerequisite gating inert.",
            "sessions/*/telemetry.jsonl", "#6"))
    if escalated:
        score += 0.3
    else:
        findings.append(Finding("adaptivity", "medium",
            "Universe escalation (baseline->remedial) never fired across personas.",
            "sessions/*/telemetry.jsonl", "#6"))
    return min(1.0, score)


def _score_anti_offloading(runs: list[PersonaRun], bundle: dict, findings: list[Finding]) -> float:
    score = 1.0
    # autonomyRatio always 1.0 (IMPORTANT cluster): replays should depress it but don't.
    ratios = {r.persona: r.result.get("summary", {}).get("autonomyRatio") for r in runs}
    had_replays = any(k == "replay" for r in runs for k in r.result.get("transition_kinds", []))
    if had_replays and all(v == 1 for v in ratios.values() if v is not None):
        score -= 0.4
        findings.append(Finding("anti_offloading", "high",
            f"autonomyRatio is 1.0 for every persona ({ratios}) despite replay remediation — "
            "the autonomy metric does not reflect scaffolding dependence.",
            "sessions/*/driver_result.json:summary.autonomyRatio", "#important-autonomy"))
    # ai_critique audit: did true/false positives get scored?
    audit_events = [e for r in runs for e in r.telemetry if e.get("type") == "ai_audit_result"]
    if audit_events:
        findings.append(Finding("anti_offloading", "info",
            f"ai_critique audit scored ({len(audit_events)} ai_audit_result events): "
            "true/false positives recorded against planted claim flaws.",
            "sessions/*/telemetry.jsonl:ai_audit_result", "ok"))
    return max(0.0, score)


def _score_rgpd(runs: list[PersonaRun], bundle: dict, findings: list[Finding]) -> float:
    score = 1.0
    # pseudonym keyed on lessonId only (#4): every persona over the same bundle hashes the SAME id.
    pseudos = {}
    for r in runs:
        fs = r.result.get("final_state", {})
        # the pseudonym isn't in driver_result directly; detect collision via lesson_id sharing.
        pseudos[r.persona] = fs.get("lesson_id")
    lesson_ids = set(pseudos.values())
    if len(runs) > 1 and len(lesson_ids) == 1:
        score -= 0.5
        findings.append(Finding("rgpd", "high",
            "Pseudonym is derived from lessonId only (pseudonym.ts) — all learners on the same bundle "
            "share a pseudonym; not per-learner. The harness isolates personas by outDir as a workaround.",
            "packages/lesson-session/src/adapters/pseudonym.ts", "#4"))
    # raw learner_id should never appear in telemetry
    raw_leak = any("learner_id" in e for r in runs for e in r.telemetry)
    if raw_leak:
        score -= 0.3
        findings.append(Finding("rgpd", "blocker",
            "Raw learner_id present in telemetry events.",
            "sessions/*/telemetry.jsonl", "#4"))
    findings.append(Finding("rgpd", "info",
        "forget() emits a forget_requested event but does NOT purge state/.jsonld/logs (no-op erasure).",
        "packages/lesson-session-host/src/host.ts:forget", "#4"))
    return max(0.0, score)


def _score_mastery_validity(runs: list[PersonaRun], bundle: dict, findings: list[Finding]) -> float:
    score = 1.0
    # Was mastery earned via DISTINCT items + min attempts, or two same-item corrects = 0.80 = theta?
    for r in runs:
        for cid, cs in r.result.get("final_state", {}).get("concept_states", {}).items():
            attempts = cs.get("total_attempts", 0)
            mastery = cs.get("alpha", 1) / (cs.get("alpha", 1) + cs.get("beta", 1))
            if mastery >= 0.8 and attempts <= 2:
                score -= 0.3
                findings.append(Finding("mastery_validity", "high",
                    f"[{r.persona}] concept {cid} reached mastery {mastery:.2f}>=theta in only "
                    f"{attempts} attempts (no min-attempts/distinct-item floor — beta-updater.ts).",
                    "sessions/*/driver_result.json:final_state.concept_states", "#1"))
                break
        else:
            continue
        break
    findings.append(Finding("mastery_validity", "info",
        "Mastery CLAIM threshold (0.8) equals the navigation theta default; remediation can drive "
        "mastery to exactly theta via repeats on the SAME item.",
        "packages/lesson-session/src/session.ts:MASTERY_CLAIM_THRESHOLD", "#1"))
    return max(0.0, score)


# ---------------------------------------------------------------------------
# Heuristic auditor — assemble dossier + score
# ---------------------------------------------------------------------------


def heuristic_audit(run_dir: Path) -> dict:
    bundle = _read_bundle(run_dir)
    prov = json.loads((run_dir / "author_provenance.json").read_text(encoding="utf-8"))
    runs = _load_persona_runs(run_dir / "sessions")

    findings: list[Finding] = []
    dims = {
        "pedagogical_soundness": _score_pedagogical_soundness(bundle, runs, findings),
        "grounding_citations": _score_grounding(bundle, prov, findings),
        "adaptivity": _score_adaptivity(runs, bundle, findings),
        "anti_offloading": _score_anti_offloading(runs, bundle, findings),
        "rgpd": _score_rgpd(runs, bundle, findings),
        "mastery_validity": _score_mastery_validity(runs, bundle, findings),
    }
    # Declared NON-GOALS so the auditor never scores them as broken.
    non_goals = [
        Finding("non_goal", "info",
            "Reproduction scenes use ackGrader (zero student-facing behavior); Mode-B runtime gating "
            "is a declared NON-GOAL — not scored.",
            "packages/lesson-session/src/grading/graders.ts", "#5"),
        Finding("non_goal", "info",
            "Discussion scenes score via StubReasoningScorer (always {justification,0.5}) when live=false; "
            "discussion adaptivity is inert offline.",
            "packages/lesson-session/src/adapters/reasoning-scorer.ts", "discussion-non-goal"),
    ]
    findings.extend(non_goals)

    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.severity, 99))
    overall = round(sum(dims.values()) / len(dims), 3)

    persona_signals = {
        r.persona: {
            "completed": r.result.get("completed"),
            "n_turns": r.result.get("n_turns"),
            "transition_kinds": _summarize_transitions(r.result.get("transition_kinds", [])),
            "autonomyRatio": r.result.get("summary", {}).get("autonomyRatio") if r.result.get("summary") else None,
            "adaptation_rules_fired": _summarize_rules(r.adaptation_rules),
            "final_concept_mastery": r.result.get("final_concept_mastery", {}),
        }
        for r in runs
    }

    return {
        "auditor": "heuristic",
        "corpus_id": prov.get("corpus_id"),
        "corpus_title": prov.get("corpus_title"),
        "author_mode": prov.get("author_mode"),
        "overall_score": overall,
        "dimension_scores": dims,
        "findings": [f.as_dict() for f in findings],
        "persona_signals": persona_signals,
        "harness_signals": {
            "n_personas": len(runs),
            "all_personas_completed": all(r.result.get("completed") for r in runs) if runs else False,
            "personas_branched": len({tuple(r.result.get("transition_kinds", [])) for r in runs}) > 1,
            "lwg_present": bool(bundle.get("learning_workflow_graph")),
            "universes_present": bool(bundle.get("universes")),
            "bundler_validated_at_offset_defect": prov.get("bundler_validated_at_offset_defect"),
        },
    }


def _summarize_transitions(kinds: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for k in kinds:
        out[k] = out.get(k, 0) + 1
    return out


def _summarize_rules(rules: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for r in rules:
        if r:
            out[r] = out.get(r, 0) + 1
    return out


def _read_bundle(run_dir: Path) -> dict:
    import zipfile

    bz = next(run_dir.glob("*-bundle.zip"), None)
    if bz is None:
        raise FileNotFoundError(f"no *-bundle.zip in {run_dir}")
    with zipfile.ZipFile(bz) as zf:
        return json.loads(zf.read("lesson.json"))


# ---------------------------------------------------------------------------
# Claude auditor (optional augmentation)
# ---------------------------------------------------------------------------

_AUDITOR_SYSTEM = (
    "You are a rigorous course-quality auditor for an adaptive tutoring backend. You score a "
    "generated lesson + simulated learner runs against a pedagogy/grounding/adaptivity rubric. "
    "You are skeptical, evidence-based, and you output strict JSON only."
)


def claude_audit_augment(run_dir: Path, heuristic: dict, model: str | None = None) -> dict:
    """Ask Claude for a pedagogical narrative + extra findings; merge onto heuristic."""
    if not claude_available():
        heuristic["claude_audit"] = {"skipped": "claude CLI unavailable"}
        return heuristic
    bundle = _read_bundle(run_dir)
    digest = {
        "metadata": bundle.get("metadata"),
        "concepts": [{"id": c["id"], "title": c["title"], "bloom": c["bloom_level_target"]} for c in bundle.get("concepts", [])],
        "scene_types": [s["type"] for s in bundle.get("scenes", [])],
        "n_lwg_edges": len((bundle.get("learning_workflow_graph") or {}).get("edges", [])),
        "heuristic_dimension_scores": heuristic["dimension_scores"],
        "persona_signals": heuristic["persona_signals"],
    }
    prompt = f"""Here is an audit dossier for an auto-generated adaptive lesson and its simulated learner runs:
{json.dumps(digest, indent=2)}

Assess PEDAGOGICAL SOUNDNESS and ADAPTIVITY specifically. Return STRICT JSON:
{{
  "pedagogical_narrative": "<2-4 sentences: are the concepts coherent, is the Bloom progression sound, do the personas reveal real adaptivity?>",
  "extra_findings": [
    {{"dimension": "pedagogical_soundness|adaptivity|grounding_citations", "severity": "high|medium|low|info", "summary": "<one sentence>"}}
  ],
  "course_refinement": ["<actionable suggestion to improve the generated course>", "..."]
}}"""
    try:
        cli = ClaudeCli(model=model)
        data = cli.complete_json(prompt, system=_AUDITOR_SYSTEM)
        heuristic["claude_audit"] = data
        heuristic["auditor"] = "heuristic+claude"
    except Exception as exc:  # never let the LLM pass break the offline audit
        heuristic["claude_audit"] = {"error": str(exc)[:300]}
    return heuristic


def run_audit(run_dir: Path, use_llm: bool = False, model: str | None = None) -> dict:
    audit = heuristic_audit(run_dir)
    if use_llm:
        audit = claude_audit_augment(run_dir, audit, model=model)
    (run_dir / "audit.json").write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    return audit


__all__ = ["run_audit", "heuristic_audit", "Finding"]
