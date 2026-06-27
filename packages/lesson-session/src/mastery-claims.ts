import { masteryOf, isOverconfident, isOverTrusting, type LearnerState } from "@studium/learner-state";
import { MIN_MASTERY_ATTEMPTS } from "./graph-nav.js";

/** A local-only JSON-LD doc of learner mastery claims (indicium Bucur 5-slot + SEPIO evidence).
 * Mirrors the Python graph_to_claims shape. RGPD: subject is a pseudonym; this doc is LOCAL-ONLY. */
export interface MasteryClaimsDoc {
  "@context": Record<string, string>;
  "@id": string;
  "@graph": Array<Record<string, unknown>>;
}

export interface BuildMasteryClaimsOptions {
  pseudonym: string;
  sessionId: string;
  bundleId: string;
  activeUniverseId: string;
  threshold: number;
}

const _CONTEXT: Record<string, string> = {
  asb: "https://asb.holobiomics.org/ns/asb#",
  prov: "http://www.w3.org/ns/prov#",
  sepio: "http://purl.obolibrary.org/obo/SEPIO_",
  eco: "http://purl.obolibrary.org/obo/ECO_",
  dct: "http://purl.org/dc/terms/",
};

/** Build the local mastery-claims doc: one asb:Claim + SEPIO Evidence per concept whose
 * mastery >= threshold AND total_attempts >= MIN_MASTERY_ATTEMPTS. Pure; no I/O. Concepts below
 * the threshold OR below the minimum-attempts floor produce no claim (anti-fabrication). */
export function buildMasteryClaims(state: LearnerState, opts: BuildMasteryClaimsOptions): MasteryClaimsDoc {
  const graph: Array<Record<string, unknown>> = [];
  for (const [cid, csv] of Object.entries(state.concept_states)) {
    if (csv.total_attempts < MIN_MASTERY_ATTEMPTS) continue; // minimum-attempts floor: 2 lucky answers don't certify mastery
    const mastery = masteryOf(csv);
    if (mastery < opts.threshold) continue;
    // CALIBRATION GATE (OVERCONFIDENCE-ONLY, deliberate). Withhold certification only for the DANGEROUS
    // direction — a measured-OVERconfident learner. We do NOT withhold from an underconfident-but-proven
    // master: a symmetric gate would, arithmetically, fire ONLY against underconfident masters (for a
    // mastered concept actual≥θ caps the overconfident gap below the band), turning a metacognition
    // signal into a competence penalty. Unmeasured concepts are unaffected (never self-assessed ⇒ never
    // withheld). The SKIP gate (graph-nav) stays symmetric — replaying to recalibrate is a low-cost nudge.
    if (isOverconfident(csv)) continue;
    // TRUST-CALIBRATION GATE (OVER-TRUST-ONLY, the north-star destination). Withhold certification from a
    // measured OVER-TRUSTING learner — one who systematically failed to catch flaws in AI readings of REAL
    // executed results (credulous of wrong output). In an AI-operated science world calibrated trust IS the
    // assessed destination, so competence alone does not certify. Over-DIStrust (skepticism) is NOT withheld
    // (mirrors the overconfidence-only direction); unmeasured concepts are unaffected.
    if (isOverTrusting(csv)) continue;
    const claimId = `urn:studium:mastery:${opts.sessionId}:${cid}`;
    graph.push({
      "@type": "asb:Claim",
      id: claimId,
      context: `lesson:${opts.bundleId}`,
      subject: opts.pseudonym,
      relation: "demonstrates mastery of",
      object: cid,
      claim_type: "implicit",
      claim_status: "draft",
      asserted_by: `urn:studium:lesson-session:${opts.sessionId}`,
      domain_qualifier: "demonstrates_mastery_of",
    });
    // indicium-conformant Evidence (sepio:0000002). Mapping of the learner
    // performance signal to LEGAL LinkML slots (indicium.yaml:510-516):
    //  - source_type:"performance" is NOT a SourceType member (text/figure/
    //    table/image/code/data) -> dropped; the runtime origin is conveyed by
    //    eco_code:"computational_evidence" (ECO:0000251 — derived from pipeline/
    //    runtime output, indicium.yaml:168).
    //  - total_attempts/total_correct/confidence_calibration are NOT slots ->
    //    folded into the free-text `quote_location` locator (lossy but legal;
    //    a typed learner-evidence numeric bag is an upstream indicium backlog).
    //  - active_universe -> `decision_context` as a dotted `universe.<id>` tag
    //    (bare values fail the decision_context pattern). Omitted when empty.
    const ev: Record<string, unknown> = {
      "@type": "sepio:0000002",
      supports_claim: claimId,
      evidence_type: "inference",
      eco_code: "computational_evidence",
      confidence: mastery,
      quote_location: `attempts=${csv.total_attempts};correct=${csv.total_correct};calibration=${csv.confidence_calibration}`,
    };
    if (opts.activeUniverseId) {
      // Sanitize the universe segment so the result always matches the indicium
      // decision_context pattern: ^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$
      // Raw ids like "remedial-v2" or "2024-cohort" would fail — replace illegal
      // chars and ensure the segment starts with a letter or underscore.
      let seg = opts.activeUniverseId.replace(/[^a-zA-Z0-9_]/g, "_");
      if (!/^[a-zA-Z_]/.test(seg)) seg = "_" + seg; // leading digit -> prepend "_"
      ev.decision_context = [`universe.${seg}`];
    }
    graph.push(ev);
  }
  return {
    "@context": { ..._CONTEXT },
    "@id": `urn:studium:mastery-set:${opts.bundleId}:${opts.sessionId}`,
    "@graph": graph,
  };
}
