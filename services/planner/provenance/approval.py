"""HITL course approval (critical #8 / concept_v2 rule-003 strict human-in-the-loop).

A generated course's author-time claims are emitted with claim_status="draft"
(graph_to_indicium.py). NOTHING flips them to "verified" except an explicit human
APPROVAL through this module. This is the gate that keeps a generated course out
of student reach until a teacher reviews and vouches for it.

Two public functions, both pure-ish + deterministic (timestamps are PASSED IN,
never now(); no network, no LLM):

  approve_course(course_dir, *, approver, decision, approved_at, ...)
      decision=="approve" + a non-empty approver + a non-empty approved_at flips
      each (selected) draft Claim's claim_status draft->verified and rewrites its
      `asserted_by` to the approver IRI (prov:wasAttributedTo the human who now
      vouches for it). The original generator IRI is preserved in the returned
      record + the approval.json sidecar (prior_assertions). reject/hold record
      the decision but leave every claim draft. Re-approve is idempotent
      (already-verified claims are skipped, never overwritten).

  build_course_audit_report(course_dir, *, out_dir=None)
      Read-only join of the LWG claim graph + its SEPIO Evidence + the ASTRA
      decisions/findings + the approval record into course_audit_report.json
      and a teacher-facing course_audit_report.md.

KEY CONSTRAINT (indicium conformance): the indicium Claim has NO approved_by /
approved_at / validated_by slot, and the model is extra="forbid". So approver
provenance is recorded through the LEGAL `asserted_by` slot + the approval.json
sidecar — NEVER as invented Claim keys. assert_claim_conformant() guards each
mutated claim so a regression that adds an illegal key fails loudly.
"""
from __future__ import annotations

import json
import os
from typing import Any, Optional

from provenance.indicium_schema_vendored import assert_claim_conformant
from provenance.astra_emit import analysis_body, source_edge_id
from provenance.astra_read import summary_lines, universe_summary

LWG_JSONLD = "lwg.indicium.jsonld"
LWG_GRAPH_JSON = "lwg.graph.json"
APPROVAL_JSON = "approval.json"
ASTRA_YAML = "astra.yaml"
AUDIT_JSON = "course_audit_report.json"
AUDIT_MD = "course_audit_report.md"

# An edge whose confidence is below this is flagged for teacher scrutiny even when it
# carries no quality_flags. Mirrors GraphBuilder admission: a grounded edge gets >=0.6;
# the ungrounded plan-artifact fallback gets 0.4, so 0.5 catches the weak ones.
_LOW_CONFIDENCE_THRESHOLD = 0.5

_CLAIM_TYPE = "asb:Claim"
_EVIDENCE_TYPE = "sepio:0000002"
_DECISIONS = {"approve", "reject", "hold"}


# --------------------------------------------------------------------------- #
# small pure helpers
# --------------------------------------------------------------------------- #
def _load_jsonld(course_dir: str) -> dict[str, Any]:
    with open(os.path.join(course_dir, LWG_JSONLD), encoding="utf-8") as f:
        return json.load(f)


def _dump_jsonld(course_dir: str, doc: dict[str, Any]) -> None:
    # mutate-in-place + sort_keys=False preserves the author-time key order;
    # only claim_status + asserted_by change on the touched claims.
    with open(os.path.join(course_dir, LWG_JSONLD), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2, sort_keys=False)


def _claim_nodes(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [n for n in doc.get("@graph", []) if n.get("@type") == _CLAIM_TYPE]


def _evidence_nodes(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [n for n in doc.get("@graph", []) if n.get("@type") == _EVIDENCE_TYPE]


def _load_approval_history(course_dir: str) -> list[dict[str, Any]]:
    path = os.path.join(course_dir, APPROVAL_JSON)
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else [data]


def _load_yaml_if_present(path: str) -> Optional[dict[str, Any]]:
    if not os.path.exists(path):
        return None
    import yaml
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _load_raw_graph_if_present(course_dir: str) -> Optional[dict[str, Any]]:
    """The RAW internal LWG graph (lwg.graph.json) carries edge-level quality_flags +
    confidence that the indicium JSON-LD drops (Claim is extra=forbid). Absent for
    older courses — return None and the report degrades gracefully (no flags section)."""
    path = os.path.join(course_dir, LWG_GRAPH_JSON)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _flagged_edges(raw_graph: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project the raw-graph edges a teacher must scrutinize: any edge with non-empty
    quality_flags OR confidence below _LOW_CONFIDENCE_THRESHOLD. Graph order preserved
    (deterministic). Returns [] when no raw graph is available."""
    if not raw_graph:
        return []
    out: list[dict[str, Any]] = []
    for edge in raw_graph.get("edges", []):
        flags = edge.get("quality_flags") or []
        conf = edge.get("confidence")
        low_conf = isinstance(conf, (int, float)) and conf < _LOW_CONFIDENCE_THRESHOLD
        if not flags and not low_conf:
            continue
        out.append({
            "id": edge.get("id"),
            "relation": edge.get("relation"),
            "source": edge.get("source"),
            "target": edge.get("target"),
            "confidence": conf,
            "quality_flags": list(flags),
            "low_confidence": bool(low_conf),
            "astra_insight_ref": edge.get("astra_insight_ref"),
        })
    return out


# --------------------------------------------------------------------------- #
# (a) approve_course
# --------------------------------------------------------------------------- #
def approve_course(
    course_dir: str,
    *,
    approver: str,
    decision: str,
    approved_at: str,
    selected_claim_ids: Optional[list[str]] = None,
    note: Optional[str] = None,
) -> dict[str, Any]:
    """Review-and-decide on a generated course.

    On decision=="approve" (with a non-empty `approver` AND a non-empty
    `approved_at`), flip each targeted draft Claim's claim_status to "verified"
    and rewrite its `asserted_by` to `approver`. reject/hold leave every claim
    draft. Appends an approval record to approval.json (full history) and returns
    that record.

    Anti-fabrication: verified is reachable ONLY here, and ONLY when decision=="approve"
    with both an approver and a passed-in timestamp — all enforced as ValueErrors
    BEFORE any mutation, so a missing identity/timestamp can never produce a
    verified course.
    """
    if decision not in _DECISIONS:
        raise ValueError(f"decision must be one of {sorted(_DECISIONS)}, got {decision!r}")
    if decision == "approve":
        if not approver:
            raise ValueError("approve requires an approver (the human vouching for the course)")
        if not approved_at:
            raise ValueError("approve requires an explicit approved_at timestamp (deterministic; never now())")

    doc = _load_jsonld(course_dir)
    claims = _claim_nodes(doc)
    total = len(claims)

    flipped: list[str] = []
    prior_assertions: dict[str, str] = {}

    if decision == "approve":
        selected = set(selected_claim_ids) if selected_claim_ids is not None else None
        for claim in claims:
            cid = claim.get("id")
            if selected is not None and cid not in selected:
                continue
            # Only ever flip a claim that is currently draft — already-verified
            # (or otherwise-statused) claims are skipped so a re-approve never
            # silently overwrites a prior decision.
            if claim.get("claim_status") != "draft":
                continue
            prior_assertions[cid] = claim.get("asserted_by")
            claim["claim_status"] = "verified"
            claim["asserted_by"] = approver
            flipped.append(cid)
            # conformance guard: verified is legal + no new keys were added.
            assert_claim_conformant(claim)
        if flipped:
            _dump_jsonld(course_dir, doc)

    verified_count = sum(1 for c in claims if c.get("claim_status") == "verified")
    record = {
        "course_dir_id": os.path.basename(os.path.normpath(course_dir)),
        "approver": approver or None,
        "decision": decision,
        "approved_at": approved_at or None,
        "note": note,
        "selected_claim_ids": selected_claim_ids,
        "flipped_claim_ids": flipped,
        "prior_assertions": prior_assertions,
        "claim_count": total,
        "verified_count": verified_count,
    }

    history = _load_approval_history(course_dir)
    history.append(record)
    with open(os.path.join(course_dir, APPROVAL_JSON), "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2, sort_keys=False)
    return record


# --------------------------------------------------------------------------- #
# (b) build_course_audit_report
# --------------------------------------------------------------------------- #
def _evidence_for(claim_id: str, evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Project each SEPIO Evidence node supporting `claim_id` into a flat, teacher
    readable dict (graph order preserved for determinism)."""
    out: list[dict[str, Any]] = []
    for ev in evidence:
        if ev.get("supports_claim") != claim_id:
            continue
        src = ev.get("of_source") or {}
        of_source = src.get("doi") or src.get("identifier")
        out.append({
            "evidence_type": ev.get("evidence_type"),
            "source_type": ev.get("source_type"),
            "of_source": of_source,
            "quote": ev.get("quote"),
            "quote_location": ev.get("quote_location"),
            "confidence": ev.get("confidence"),
            "decision_context": ev.get("decision_context"),
            # grounded := a real source backs it (a citation, or any of_source).
            "grounded": ev.get("evidence_type") == "citation" or bool(of_source),
        })
    return out


def _universe_decisions(universe: dict[str, Any]) -> dict[str, Any]:
    """The option selection of a universe.yaml in either shape: nested ASB form
    (`analyses.<slug>.decisions`, merged across slugs) or the older flat form."""
    analyses = universe.get("analyses")
    if not analyses:
        return universe.get("decisions") or {}
    merged: dict[str, Any] = {}
    for body in analyses.values():
        merged.update(body.get("decisions") or {})
    return merged


def _by_source_edge_id(container: Optional[dict[str, Any]]
                       ) -> dict[str, dict[str, Any]]:
    """Index an ASTRA container by the raw Studium edge id each entry was keyed by.
    Emitted ids are slugified to the ASTRA grammar, so the raw id lives in the
    `source_edge_id:<raw>` tag (files written before 2026-09-03: the extension key
    of that name; files written before the coercion: the key itself) --
    source_edge_id() resolves all three. Input: a decisions/findings map. Output:
    raw edge id -> entry body."""
    return {source_edge_id(body, key): body
            for key, body in (container or {}).items()}


def _astra_for(claim: dict[str, Any], astra: Optional[dict[str, Any]]
               ) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
    """Join a claim to its ASTRA decision + finding via astra_insight_ref.
    The ref is "<analysis_id>/<edge_id>"; astra.yaml keys decisions/findings by a
    slugified id, so the join goes through source_edge_id()."""
    if not astra:
        return None, None
    _, analysis = analysis_body(astra)
    ref = claim.get("astra_insight_ref") or ""
    edge_id = ref.split("/", 1)[1] if "/" in ref else ref
    decision = _by_source_edge_id(analysis.get("decisions")).get(edge_id)
    finding = _by_source_edge_id(analysis.get("findings")).get(edge_id)
    decision_view = None
    if decision is not None:
        decision_view = {
            "label": decision.get("label"),
            "rationale": decision.get("rationale"),
            "default": decision.get("default"),
            "options": decision.get("options"),
        }
    finding_view = None
    if finding is not None:
        finding_view = {
            "claim": finding.get("claim"),
            "evidence": finding.get("evidence"),
            "created_at": finding.get("created_at"),
        }
    return decision_view, finding_view


def build_course_audit_report(
    course_dir: str, *, out_dir: Optional[str] = None,
) -> tuple[str, str]:
    """Emit course_audit_report.json + .md joining the LWG claim graph, its SEPIO
    Evidence, the ASTRA decisions/findings, and the approval record. Pure read of
    the .lwg dir; fully idempotent (overwrites the two report files). Returns
    (json_path, md_path)."""
    out_dir = out_dir or course_dir
    os.makedirs(out_dir, exist_ok=True)

    doc = _load_jsonld(course_dir)
    claims = _claim_nodes(doc)
    evidence = _evidence_nodes(doc)
    astra = _load_yaml_if_present(os.path.join(course_dir, ASTRA_YAML))
    raw_graph = _load_raw_graph_if_present(course_dir)
    flagged_edges = _flagged_edges(raw_graph)

    universes: dict[str, Any] = {}
    universes_dir = os.path.join(course_dir, "universes")
    if os.path.isdir(universes_dir):
        for fn in sorted(os.listdir(universes_dir)):
            if not fn.endswith(".yaml"):
                continue
            u = _load_yaml_if_present(os.path.join(universes_dir, fn))
            if u and u.get("id"):
                universes[u["id"]] = {
                    "description": u.get("description"),
                    "decisions": _universe_decisions(u),
                    # Computed here, while `astra` is still in hand: `_render_markdown` runs
                    # from the report alone. The full selection stays above — the report is
                    # also read as data — and only the SECTION shows the delta (nit 3).
                    "summary": universe_summary(u, astra),
                }

    history = _load_approval_history(course_dir)
    pending = {"decision": "pending", "approver": None, "approved_at": None}
    approval = history[-1] if history else pending

    claim_views: list[dict[str, Any]] = []
    for claim in sorted(claims, key=lambda c: c.get("id") or ""):
        ev = _evidence_for(claim["id"], evidence)
        astra_decision, astra_finding = _astra_for(claim, astra)
        # v1 quality_flags proxy (true edge-level flags don't reach the jsonld —
        # see module/design notes): weak-grounding + still-draft-post-approval.
        flags: list[str] = []
        confidences = [e["confidence"] for e in ev if e.get("confidence") is not None]
        max_conf = max(confidences) if confidences else None
        if max_conf is not None and max_conf < 0.5:
            flags.append("low_confidence_evidence")
        if not any(e["grounded"] for e in ev):
            flags.append("ungrounded")
        if approval.get("decision") == "approve" and claim.get("claim_status") == "draft":
            flags.append("not_approved")
        view = {
            "id": claim["id"],
            "subject": claim.get("subject"),
            "relation": claim.get("relation"),
            "object": claim.get("object"),
            "claim_status": claim.get("claim_status"),
            "asserted_by": claim.get("asserted_by"),
            "domain_qualifier": claim.get("domain_qualifier"),
            "astra_insight_ref": claim.get("astra_insight_ref"),
            "evidence": ev,
            "astra_decision": astra_decision,
            "astra_finding": astra_finding,
            "quality_flags": flags,
            "max_confidence": max_conf,
        }
        if "qualifier" in claim:
            view["qualifier"] = claim["qualifier"]
        claim_views.append(view)

    verified_count = sum(1 for c in claims if c.get("claim_status") == "verified")
    draft_count = sum(1 for c in claims if c.get("claim_status") == "draft")
    grounded_count = sum(1 for v in claim_views if any(e["grounded"] for e in v["evidence"]))
    flagged_count = sum(1 for v in claim_views if v["quality_flags"])

    report = {
        "course_dir_id": os.path.basename(os.path.normpath(course_dir)),
        "generated_from": {
            LWG_JSONLD: True,
            LWG_GRAPH_JSON: raw_graph is not None,
            ASTRA_YAML: astra is not None,
            "universes": sorted(universes.keys()),
        },
        "approval": approval,
        "approval_history": history,
        "summary": {
            "claim_count": len(claims),
            "verified_count": verified_count,
            "draft_count": draft_count,
            "evidence_count": len(evidence),
            "flagged_count": flagged_count,
            "flagged_edge_count": len(flagged_edges),
            "grounded_count": grounded_count,
            "decision_count": len((analysis_body(astra)[1] if astra else {}).get("decisions") or {}),
        },
        "claims": claim_views,
        "flagged_edges": flagged_edges,
        "universes": universes,
        "decisions": (analysis_body(astra)[1] if astra else {}).get("decisions") or {},
    }

    json_path = os.path.join(out_dir, AUDIT_JSON)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, sort_keys=False)

    md_path = os.path.join(out_dir, AUDIT_MD)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(_render_markdown(report))
    return json_path, md_path


def _render_markdown(report: dict[str, Any]) -> str:
    s = report["summary"]
    ap = report["approval"]
    not_cleared = ap.get("decision") != "approve" or s["draft_count"] > 0
    lines: list[str] = []
    lines.append(f"# Course Audit Report — {report['course_dir_id']}")
    lines.append("")
    lines.append("## Approval")
    lines.append("")
    lines.append(f"- **Decision:** {ap.get('decision')}")
    lines.append(f"- **Approver:** {ap.get('approver') or '—'}")
    lines.append(f"- **Approved at:** {ap.get('approved_at') or '—'}")
    if ap.get("note"):
        lines.append(f"- **Note:** {ap['note']}")
    if not_cleared:
        lines.append("")
        lines.append("> **NOT cleared for students** — not every claim is verified "
                     "(or no approval recorded). Students remain blocked until a "
                     "teacher approves the course.")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Claims | Verified | Draft | Grounded | Flagged | Decisions |")
    lines.append("|---|---|---|---|---|---|")
    lines.append(f"| {s['claim_count']} | {s['verified_count']} | {s['draft_count']} "
                 f"| {s['grounded_count']} | {s['flagged_count']} | {s['decision_count']} |")
    lines.append("")
    # Edge-level fidelity (GAP #8): the raw LWG graph carries quality_flags + confidence
    # the indicium JSON-LD drops. Surface the edges a teacher must scrutinize. Only
    # rendered when lwg.graph.json is present + has something to flag (graceful degrade).
    flagged_edges = report.get("flagged_edges") or []
    if flagged_edges:
        lines.append("## Flagged / low-confidence edges")
        lines.append("")
        lines.append("> Edges from the raw learning-workflow graph with quality flags "
                     "or confidence below threshold — review these before approving.")
        lines.append("")
        lines.append("| Edge | Relation | Source → Target | Confidence | Flags |")
        lines.append("|---|---|---|---|---|")
        for e in flagged_edges:
            conf = e.get("confidence")
            conf_s = f"{conf:.2f}" if isinstance(conf, (int, float)) else "—"
            flags = ", ".join(e.get("quality_flags") or [])
            if e.get("low_confidence") and "low_confidence" not in flags:
                flags = (flags + ", " if flags else "") + "low_confidence"
            flags = flags or "—"
            lines.append(
                f"| `{e.get('id')}` | {e.get('relation')} | "
                f"{e.get('source')} → {e.get('target')} | {conf_s} | {flags} |"
            )
        lines.append("")
    lines.append("## Claims")
    lines.append("")
    for c in report["claims"]:
        confs = [e["confidence"] for e in c["evidence"] if e.get("confidence") is not None]
        max_conf = f"{max(confs):.2f}" if confs else "—"
        grounded = "yes" if any(e["grounded"] for e in c["evidence"]) else "no"
        flags = ", ".join(c["quality_flags"]) or "—"
        lines.append(f"### {c.get('subject')} —{c.get('relation')}→ {c.get('object')}")
        lines.append("")
        lines.append(f"- id: `{c['id']}`")
        lines.append(f"- status: **{c.get('claim_status')}** | asserted_by: `{c.get('asserted_by')}`")
        lines.append(f"- max confidence: {max_conf} | grounded: {grounded} | flags: {flags}")
        for e in c["evidence"]:
            conf = e.get("confidence")
            conf_s = f"{conf:.2f}" if isinstance(conf, (int, float)) else "—"
            loc = e.get("quote_location") or ""
            dc = ", ".join(e.get("decision_context") or [])
            lines.append(
                f"  - evidence: {e.get('evidence_type')} | source: `{e.get('of_source') or '—'}` "
                f"| conf {conf_s} | {loc} | {dc}".rstrip(" |").rstrip()
            )
        if c.get("astra_decision"):
            d = c["astra_decision"]
            lines.append(f"  - ASTRA decision: {d.get('label')} → default `{d.get('default')}` "
                         f"({d.get('rationale')})")
        lines.append("")
    lines.append("## Pedagogical universes")
    lines.append("")
    if report.get("universes"):
        lines.append("Each universe is a delta: the decisions it moves, then a count of the "
                     "ones it leaves at their default.")
        lines.append("")
    for uid, u in (report.get("universes") or {}).items():
        lines.append(f"- **{uid}** — {u.get('description') or ''}")
        # A report written before `summary` existed still renders, from its full selection.
        lines += (summary_lines(u["summary"]) if isinstance(u.get("summary"), dict)
                  else [f"  - {did}: `{opt}`" for did, opt in (u.get("decisions") or {}).items()])
    lines.append("")
    return "\n".join(lines)
