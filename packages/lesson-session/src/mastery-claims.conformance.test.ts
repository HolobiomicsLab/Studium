import { describe, it, expect } from "vitest";
import { buildMasteryClaims } from "./mastery-claims";
import { assertClaimConformant, assertEvidenceConformant } from "./indicium-schema-vendored";
import type { LearnerState } from "@studium/learner-state";

// Mirrors mastery-claims.test.ts fixtures; checks indicium LinkML conformance of
// every emitted node against the vendored enum/slot sets (copied from
// indicium.yaml:490-516). Self-contained — runs in CI, no skip path.
function cs(alpha: number, beta: number, total_attempts = 3) {
  return { concept_id: "x", alpha, beta, consecutive_errors: 0, total_attempts, total_correct: 2, confidence_calibration: 0.1 };
}
function state(concept_states: Record<string, ReturnType<typeof cs>>): LearnerState {
  return { lesson_id: "L1", schema_version: "1.0", concept_states, scenes_completed: [], scenes_replayed: {}, history: [], session_started_at: "2026-06-11T00:00:00Z", last_decision: null } as unknown as LearnerState;
}
const OPTS = { pseudonym: "anon-7", sessionId: "sess-1", bundleId: "L1", activeUniverseId: "baseline", threshold: 0.8 };

describe("buildMasteryClaims indicium conformance", () => {
  it("every emitted node uses only legal indicium slots/enums", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    expect(doc["@graph"].length).toBeGreaterThan(0);
    for (const node of doc["@graph"]) {
      if (node["@type"] === "asb:Claim") assertClaimConformant(node);
      else if (node["@type"] === "sepio:0000002") assertEvidenceConformant(node);
      else throw new Error(`unexpected node @type: ${String(node["@type"])}`);
    }
  });

  it("Evidence emits no illegal learner fields (total_attempts/active_universe/etc.)", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    for (const illegal of ["total_attempts", "total_correct", "confidence_calibration", "active_universe", "source_type"]) {
      expect(ev).not.toHaveProperty(illegal);
    }
  });

  it("learner performance counts are preserved in a legal slot (quote_location)", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    expect(String(ev.quote_location)).toContain("attempts=3");
    expect(String(ev.quote_location)).toContain("correct=2");
  });

  it("active universe is encoded as a dotted decision_context tag", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    expect(ev.decision_context).toEqual(["universe.baseline"]);
  });

  it("performance-derived evidence carries the computational_evidence ECO code", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), OPTS);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    expect(ev.evidence_type).toBe("inference");
    expect(ev.eco_code).toBe("computational_evidence");
  });

  // ---- breaking universe ids: sanitize-or-fail conformance guard ----
  const DECISION_CONTEXT_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

  it("universe id with hyphens (remedial-v2) is sanitized to a valid dotted tag", () => {
    const opts = { ...OPTS, activeUniverseId: "remedial-v2" };
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), opts);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    const dc = ev.decision_context as string[];
    expect(dc).toHaveLength(1);
    expect(DECISION_CONTEXT_RE.test(dc[0]!)).toBe(true);
    // hyphens replaced with underscores
    expect(dc[0]).toBe("universe.remedial_v2");
    // the whole Evidence node must still be conformant
    assertEvidenceConformant(ev);
  });

  it("universe id with leading digit (2024-cohort) is sanitized to a valid dotted tag", () => {
    const opts = { ...OPTS, activeUniverseId: "2024-cohort" };
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), opts);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    const dc = ev.decision_context as string[];
    expect(dc).toHaveLength(1);
    expect(DECISION_CONTEXT_RE.test(dc[0]!)).toBe(true);
    // hyphens -> underscores + leading digit -> prepended underscore
    expect(dc[0]).toBe("universe._2024_cohort");
    // the whole Evidence node must still be conformant
    assertEvidenceConformant(ev);
  });

  it("universe id with a space (baseline 1) is sanitized to a valid dotted tag", () => {
    const opts = { ...OPTS, activeUniverseId: "baseline 1" };
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1) }), opts);
    const ev = doc["@graph"].find((n) => n["@type"] === "sepio:0000002") as Record<string, unknown>;
    const dc = ev.decision_context as string[];
    expect(dc).toHaveLength(1);
    expect(DECISION_CONTEXT_RE.test(dc[0]!)).toBe(true);
    assertEvidenceConformant(ev);
  });
});
