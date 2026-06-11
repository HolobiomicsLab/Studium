import { masteryOf, type LearnerState } from "@studium/learner-state";
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
    graph.push({
      "@type": "sepio:0000002",
      supports_claim: claimId,
      evidence_type: "inference",
      source_type: "performance",
      confidence: mastery,
      total_attempts: csv.total_attempts,
      total_correct: csv.total_correct,
      confidence_calibration: csv.confidence_calibration,
      active_universe: opts.activeUniverseId,
    });
  }
  return {
    "@context": { ..._CONTEXT },
    "@id": `urn:studium:mastery-set:${opts.bundleId}:${opts.sessionId}`,
    "@graph": graph,
  };
}
