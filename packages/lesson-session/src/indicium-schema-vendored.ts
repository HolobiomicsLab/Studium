/**
 * Vendored minimal indicium LinkML node-shape (enums + permitted slot sets) for
 * the TS mastery-claims emitter.
 *
 * indicium is a Python LinkML package — it is NOT importable from TS, and we do
 * NOT add it as a dependency. To make conformance testable in CI we vendor the
 * minimal closed enum value-sets + permitted Claim/Evidence slot names.
 *
 * SOURCE OF TRUTH (keep in lock-step with the Python vendored copy at
 * services/planner/provenance/indicium_schema_vendored.py):
 *   /Users/holobiomicslab/git/indicium/src/indicium/schema/indicium.yaml
 *     - enums          : indicium.yaml:26-188
 *     - Claim slots    : indicium.yaml:490-509
 *     - Evidence slots : indicium.yaml:510-516
 *     - domain_qualifier pattern : indicium.yaml:204-215 (^[a-z][a-z0-9_]*$)
 *     - decision_context pattern : indicium.yaml:333-338 (dotted id.option)
 *   Generated Pydantic mirror (extra="forbid"): src/indicium/generated/model.py:36-46
 */

export const CLAIM_TYPE = new Set(["explicit", "implicit"]);
export const CLAIM_STATUS = new Set(["draft", "verified", "published", "retracted", "superseded"]);
export const EVIDENCE_TYPE = new Set(["data", "citation", "knowledge", "inference", "speculation"]);
export const SOURCE_TYPE = new Set(["text", "figure", "table", "image", "code", "data"]);
export const SUPER_PATTERN_QUALIFIER = new Set([
  "causes", "prevents", "inhibits", "activates", "increases", "decreases",
  "correlates_with", "is_associated_with", "predicts", "interacts_with",
  "produces", "requires", "enables", "treats", "enhances", "reduces",
  "has_property", "is_part_of", "is_a", "consistent_with",
]);
export const WORKFLOW_COUPLING = new Set(["tight", "loose", "ad_hoc", "unknown"]);
export const SOURCE_TASK_KIND = new Set([
  "reproduction", "analysis", "component_reconstruction", "extension",
]);
export const ECO_CODE_ASB_SUBSET = new Set([
  "textual_quotation", "computational_evidence", "expert_curation",
  "inference_from_background_knowledge", "author_statement",
  "experimental_evidence", "combinatorial_evidence", "traceable_author_statement",
]);

/** JSON-LD framing keys — NOT LinkML slots; the real model rejects @type, so the
 * conformance check strips them before measuring slots. */
export const JSONLD_FRAMING_KEYS = new Set(["@type", "@id", "@context"]);

export const CLAIM_SLOTS = new Set([
  "id", "context", "subject", "qualifier", "super_pattern", "domain_qualifier",
  "relation", "predicate", "object", "claim_type", "source_excerpt",
  "claim_status", "asserted_by", "astra_insight_ref", "superseded_by",
  "source_task_kind",
]);
export const EVIDENCE_SLOTS = new Set([
  "evidence_type", "eco_code", "source_type", "quote", "quote_exact",
  "quote_location", "confidence", "of_source", "for_claim", "supports_claim",
  "of_figure", "of_script", "of_dataset", "text_selector", "fragment_selector",
  "decision_context", "asserted_by", "workflow_coupling",
]);
export const SOURCE_SLOTS = new Set([
  "identifier", "doi", "title", "authors", "license_id", "paragraph_id",
  "xpath_pointer",
]);

const CLAIM_ENUM_SLOTS: Record<string, Set<string>> = {
  claim_type: CLAIM_TYPE,
  claim_status: CLAIM_STATUS,
  qualifier: SUPER_PATTERN_QUALIFIER,
  super_pattern: SUPER_PATTERN_QUALIFIER,
  source_task_kind: SOURCE_TASK_KIND,
};
const EVIDENCE_ENUM_SLOTS: Record<string, Set<string>> = {
  evidence_type: EVIDENCE_TYPE,
  source_type: SOURCE_TYPE,
  eco_code: ECO_CODE_ASB_SUBSET,
  workflow_coupling: WORKFLOW_COUPLING,
};

const DOMAIN_QUALIFIER_RE = /^[a-z][a-z0-9_]*$/;
const DECISION_CONTEXT_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

function strip(node: Record<string, unknown>): Record<string, unknown> {
  const out = { ...node };
  delete out["@type"];
  delete out["@context"];
  return out;
}

/** Throws if `node` is not a conformant indicium Claim node. */
export function assertClaimConformant(node: Record<string, unknown>): void {
  const body = strip(node);
  const extra = Object.keys(body).filter((k) => !CLAIM_SLOTS.has(k));
  if (extra.length) throw new Error(`Claim has illegal slot(s): ${extra.sort().join(", ")}`);
  for (const [slot, allowed] of Object.entries(CLAIM_ENUM_SLOTS)) {
    if (slot in body && !allowed.has(String(body[slot]))) {
      throw new Error(`Claim.${slot}=${JSON.stringify(body[slot])} not in {${[...allowed].join(",")}}`);
    }
  }
  const dq = body["domain_qualifier"];
  if (dq != null && !DOMAIN_QUALIFIER_RE.test(String(dq))) {
    throw new Error(`domain_qualifier ${JSON.stringify(dq)} fails pattern`);
  }
  // QualifierPresenceShape: at least one of {qualifier, domain_qualifier}.
  if (!body["qualifier"] && !body["domain_qualifier"]) {
    throw new Error("Claim must carry at least one of {qualifier, domain_qualifier}");
  }
}

/** Throws if `node` is not a conformant indicium Evidence node. */
export function assertEvidenceConformant(node: Record<string, unknown>): void {
  const body = strip(node);
  const extra = Object.keys(body).filter((k) => !EVIDENCE_SLOTS.has(k));
  if (extra.length) throw new Error(`Evidence has illegal slot(s): ${extra.sort().join(", ")}`);
  for (const [slot, allowed] of Object.entries(EVIDENCE_ENUM_SLOTS)) {
    if (slot in body && !allowed.has(String(body[slot]))) {
      throw new Error(`Evidence.${slot}=${JSON.stringify(body[slot])} not in {${[...allowed].join(",")}}`);
    }
  }
  const src = body["of_source"];
  if (src != null) {
    if (typeof src !== "object" || Array.isArray(src)) {
      throw new Error("of_source must be an inlined Source object");
    }
    const srcExtra = Object.keys(src as object).filter((k) => !SOURCE_SLOTS.has(k));
    if (srcExtra.length) throw new Error(`of_source (Source) has illegal slot(s): ${srcExtra.sort().join(", ")}`);
    if (!("identifier" in (src as object))) throw new Error("of_source (Source) requires `identifier`");
  }
  const dc = body["decision_context"];
  if (dc != null) {
    if (!Array.isArray(dc)) throw new Error("decision_context must be a list");
    for (const tag of dc) {
      if (!DECISION_CONTEXT_RE.test(String(tag))) {
        throw new Error(`decision_context ${JSON.stringify(tag)} fails dotted pattern`);
      }
    }
  }
}
