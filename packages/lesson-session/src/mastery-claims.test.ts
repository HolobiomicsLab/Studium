import { describe, it, expect } from "vitest";
import { buildMasteryClaims } from "./mastery-claims";
import type { LearnerState } from "@studium/learner-state";

function cs(alpha: number, beta: number) {
  return { concept_id: "x", alpha, beta, consecutive_errors: 0, total_attempts: 3, total_correct: 2, confidence_calibration: 0.1 };
}
function state(concept_states: Record<string, ReturnType<typeof cs>>): LearnerState {
  return { lesson_id: "L1", schema_version: "1.0", concept_states, scenes_completed: [], scenes_replayed: {}, history: [], session_started_at: "2026-06-11T00:00:00Z", last_decision: null } as unknown as LearnerState;
}
const OPTS = { pseudonym: "anon-7", sessionId: "sess-1", bundleId: "L1", activeUniverseId: "baseline", threshold: 0.8 };

describe("buildMasteryClaims", () => {
  it("emits a claim+evidence only for concepts at/above the threshold", () => {
    const doc = buildMasteryClaims(state({ mastered: cs(4, 1), weak: cs(2.5, 1) }), OPTS); // 0.8 vs 0.714
    const claims = doc["@graph"].filter((n: any) => n["@type"] === "asb:Claim");
    expect(claims.map((c: any) => c.object)).toEqual(["mastered"]);
    const c = claims[0] as any;
    expect(c.subject).toBe("anon-7");
    expect(c.relation).toBe("demonstrates mastery of");
    expect(c.domain_qualifier).toBe("demonstrates_mastery_of");
    expect(c.claim_status).toBe("draft");
    expect(c.claim_type).toBe("implicit");
    expect(c.asserted_by).toBe("urn:studium:lesson-session:sess-1");
    expect(c.id).toBe("urn:studium:mastery:sess-1:mastered");
    const ev = doc["@graph"].find((n: any) => n["@type"] === "sepio:0000002") as any;
    expect(ev.supports_claim).toBe(c.id);
    expect(ev.evidence_type).toBe("inference");
    expect(ev.confidence).toBeCloseTo(0.8);
    expect(ev.total_attempts).toBe(3);
    expect(ev.active_universe).toBe("baseline");
  });
  it("returns an empty @graph when no concept reaches the threshold", () => {
    const doc = buildMasteryClaims(state({ weak: cs(2.5, 1) }), OPTS);
    expect(doc["@graph"]).toEqual([]);
    expect(doc["@id"]).toBe("urn:studium:mastery-set:L1:sess-1");
  });
  it("returns an empty @graph for empty concept_states", () => {
    expect(buildMasteryClaims(state({}), OPTS)["@graph"]).toEqual([]);
  });
});
