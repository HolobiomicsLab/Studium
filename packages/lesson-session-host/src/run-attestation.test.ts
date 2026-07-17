// Brain-only run attestation: catch "operation-as-theatre" purely from what the operator returns, so an
// unverifiable run can be quarantined from grounding a judgment (and thus from feeding trust_calibration).
import { describe, it, expect } from "vitest";
import { verifyRunAttestation, type RunResult } from "./run-result.js";
import type { RunManifest } from "@studium/lesson-bundle-schema";

const manifest: RunManifest = {
  capsule_ref: "fixtures/capsule-demo", cmd: ["python", "run.py"],
  expected_outputs: ["outputs/stats.csv"], verify_checks: ["file exists: outputs/stats.csv"],
};
const faithful: RunResult = {
  ran: true, passed: true, landmark: "k=0.42",
  artifacts: ["outputs/stats.csv"], checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
};

describe("verifyRunAttestation", () => {
  it("a faithful run (declared outputs + checks + landmark) is trusted", () => {
    expect(verifyRunAttestation(manifest, faithful)).toEqual({ trusted: true, reasons: [] });
  });

  it("matches declared outputs by basename (path prefixes differ harmlessly)", () => {
    const r = { ...faithful, artifacts: ["/abs/work/stats.csv"] };
    expect(verifyRunAttestation(manifest, r).trusted).toBe(true);
  });

  it("THEATRE: passed=true but nothing produced/checked is NOT trusted", () => {
    const r: RunResult = { ran: true, passed: true, landmark: "k=0.42", artifacts: [], checks: [] };
    const a = verifyRunAttestation(manifest, r);
    expect(a.trusted).toBe(false);
    expect(a.reasons.join(" ")).toMatch(/declared output not produced/);
    expect(a.reasons.join(" ")).toMatch(/declared check not reported/);
  });

  it("passed=true while a returned check FAILED is an inconsistency", () => {
    const r: RunResult = {
      ...faithful, checks: [{ check: "file exists: outputs/stats.csv", passed: false }],
    };
    const a = verifyRunAttestation(manifest, r);
    expect(a.trusted).toBe(false);
    expect(a.reasons.join(" ")).toMatch(/declared check failed|passed=true but a returned check failed/);
  });

  it("a missing declared output is caught even if the check is (wrongly) reported passing", () => {
    const r: RunResult = { ...faithful, artifacts: [] };
    expect(verifyRunAttestation(manifest, r).trusted).toBe(false);
  });

  it("no landmark on a run that declares work is NOT trusted", () => {
    const r: RunResult = { ...faithful, landmark: "  " };
    const a = verifyRunAttestation(manifest, r);
    expect(a.trusted).toBe(false);
    expect(a.reasons.join(" ")).toMatch(/no landmark/);
  });

  it("a manifest declaring no outputs/checks makes the landmark optional (degenerate run)", () => {
    const bare: RunManifest = { capsule_ref: "c", cmd: ["run"], expected_outputs: [], verify_checks: [] };
    expect(verifyRunAttestation(bare, { ran: true, passed: true, artifacts: [], checks: [] }).trusted).toBe(true);
  });
});
