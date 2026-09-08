// Direction-2: synthetic learners with a KNOWN, independent disposition run through the REAL deck grader
// + folds + certification gate. Validation = the instrument RECOVERS the disposition and the gate holds/
// advances the right learners — with zero students and zero circularity (the disposition never reads the
// grader's key).
import { describe, it, expect } from "vitest";
import { runGateValidity, CANONICAL_LEARNERS, type GateValidityRow } from "./gate-validity.js";

const OPTS = { scenes: 8, flawedPerScene: 4, soundPerScene: 4, seed: 12345 };

async function rowsByLabel(): Promise<Record<string, GateValidityRow>> {
  const rows = await runGateValidity(CANONICAL_LEARNERS, OPTS);
  return Object.fromEntries(rows.map((r) => [r.label, r]));
}

describe("gate-validity harness — instrument recovers the hidden disposition", () => {
  it("criterion c orders the dispositions: over-truster > calibrated > over-distruster", async () => {
    const r = await rowsByLabel();
    expect(r["over-truster"]!.criterionC).toBeGreaterThan(r["calibrated"]!.criterionC);
    expect(r["calibrated"]!.criterionC).toBeGreaterThan(r["over-distruster"]!.criterionC);
    expect(r["over-truster"]!.criterionC).toBeGreaterThan(0);   // conservative = over-trust
    expect(r["over-distruster"]!.criterionC).toBeLessThan(0);   // liberal = over-distrust
  });

  it("A' discrimination is highest for the calibrated learner (competence separated from bias)", async () => {
    const r = await rowsByLabel();
    expect(r["calibrated"]!.aPrime).toBeGreaterThan(0.8);
    expect(r["calibrated"]!.aPrime).toBeGreaterThan(r["over-truster"]!.aPrime);
    expect(r["calibrated"]!.aPrime).toBeGreaterThan(r["over-distruster"]!.aPrime);
  });

  it("the signed gap recovers over-trust (>0) vs over-distrust (<0)", async () => {
    const r = await rowsByLabel();
    expect(r["over-truster"]!.trustGap).toBeGreaterThan(0.4);
    expect(r["over-distruster"]!.trustGap).toBeLessThan(0);
    expect(Math.abs(r["calibrated"]!.trustGap)).toBeLessThan(0.4);
  });
});

describe("gate-validity harness — the certification gate holds/advances correctly", () => {
  it("holds the over-truster and the competent-but-credulous learner (true holds)", async () => {
    const r = await rowsByLabel();
    expect(r["over-truster"]!.certified).toBe(false);
    expect(r["concept-strong-but-credulous"]!.certified).toBe(false);
  });

  it("advances the calibrated learner AND the over-distruster (skepticism is the safe direction)", async () => {
    const r = await rowsByLabel();
    expect(r["calibrated"]!.certified).toBe(true);
    expect(r["over-distruster"]!.certified).toBe(true);
  });

  it("false-HOLD rate over should-advance learners is zero", async () => {
    const r = await rowsByLabel();
    const shouldAdvance = ["calibrated", "over-distruster"];
    const falseHolds = shouldAdvance.filter((l) => !r[l]!.certified).length;
    expect(falseHolds).toBe(0);
  });

  it("is deterministic given the seed", async () => {
    const a = await runGateValidity(CANONICAL_LEARNERS, OPTS);
    const b = await runGateValidity(CANONICAL_LEARNERS, OPTS);
    expect(a).toEqual(b);
  });
});
