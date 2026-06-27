// A GROUNDED spot_the_flaw scene (one carrying a real executed reference_result) yields a TRUST signal
// — the audit breakdown the engine folds into trust_calibration. An ungrounded one never does.
import { describe, it, expect } from "vitest";
import type { Scene } from "@studium/lesson-bundle-schema";
import { grade } from "./index.js";
import type { CritiqueEvaluator } from "../ports.js";
import { StubCritiqueEvaluator } from "../adapters/critique-evaluator.js";

const base = {
  id: "flaw1", type: "spot_the_flaw" as const, title: "t", objective_refs: [], concept_refs: ["c1"],
  estimated_seconds: 60, adaptation_hooks: [],
  flawed_content: "k=0.42 means a slow reaction, half-life over an hour.",
  // single-keyword claims so planted == claim count (the matcher counts flaws_expected keywords)
  claims: [
    { id: "f-unit", text: "wrong half-life unit", flaws_expected: ["unites"] },
    { id: "f-order", text: "overinterprets noise", flaws_expected: ["ordre"] },
  ],
  model_correction: "k is a rate (1/time); half-life ~1.65.",
  rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
};

const REF = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", figure_path: "decay.png",
  checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
  provenance: { capsule_doi: "10.0000/demo", cmd: ["python", "scripts/run.py"], env: "isolated uv venv" },
};

const grounded: Extract<Scene, { type: "spot_the_flaw" }> = { ...base, reference_result: REF };
const ungrounded: Extract<Scene, { type: "spot_the_flaw" }> = { ...base };

const pass: CritiqueEvaluator = { async evaluate() { return { score: 0.8, feedback: "ok" }; } };

describe("spot_the_flaw grounding → trust signal", () => {
  it("a GROUNDED judgment scene attaches judgment_audit to the answer signal", async () => {
    const r = await grade(grounded, { kind: "flaw_report", text: "mauvaises unites de la demi-vie" }, { critiqueEvaluator: pass });
    const ja = (r.signal as { judgment_audit?: { grounded: boolean; planted: number; caught: number; false_positives: number } }).judgment_audit;
    expect(ja).toBeDefined();
    expect(ja!.grounded).toBe(true);
    expect(ja!.planted).toBe(2);
    expect(typeof ja!.caught).toBe("number");
    expect(typeof ja!.false_positives).toBe("number");
  });

  it("an UNGROUNDED spot_the_flaw NEVER attaches judgment_audit (no real artifact to calibrate trust against)", async () => {
    const r = await grade(ungrounded, { kind: "flaw_report", text: "demi-vie unites" }, { critiqueEvaluator: pass });
    expect((r.signal as { judgment_audit?: unknown }).judgment_audit).toBeUndefined();
  });

  it("offline (Stub): missing every flaw → an over-trust audit (caught 0 of planted 2)", async () => {
    const r = await grade(grounded, { kind: "flaw_report", text: "rien a signaler" }, { critiqueEvaluator: new StubCritiqueEvaluator() });
    expect((r.signal as { judgment_audit?: unknown }).judgment_audit).toMatchObject({ grounded: true, planted: 2, caught: 0 });
  });
});
