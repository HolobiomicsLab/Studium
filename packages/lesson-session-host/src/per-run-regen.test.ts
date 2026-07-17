// PER-RUN FLAW REGENERATION: when the learner runs a capsule, the host regenerates a downstream
// spot_the_flaw's flawed_content + claims FROM THE LEARNER'S OWN run (server-side, via an injected
// generator) — so the planted flaws match the learner's real numbers even for a stochastic capsule.
// The regenerated answer key stays server-side (publicScene strips it). Key-free via a stub generator.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { StubJudgmentGenerator } from "./judgment-generator.js";
import { publicPresentation } from "./public-scene.js";

function regenBundle() {
  return {
    schema_version: "1.4", bundle_id: "regen-demo", source_plan_id: "p",
    metadata: { title: "Regen", target: "grad", duration_minutes: 15, language: "fr", discipline: "chemistry" },
    concepts: [{ id: "c-kin", title: "C", description: "d", bloom_level_target: "evaluate" }],
    scenes: [
      { id: "s-repro", type: "reproduction", title: "Run", objective_refs: ["c-kin"], concept_refs: ["c-kin"], estimated_seconds: 0, adaptation_hooks: [], task_card_id: "demo-decay-fit",
        steps: [{ step_id: "1", instruction: "run", expected_input_schema: { type: "object" }, expected_output: "o" }],
        run_manifest: { capsule_ref: "fixtures/capsule-demo", cmd: ["python", "scripts/run.py"], expected_outputs: ["outputs/stats.csv"], verify_checks: ["file exists: outputs/stats.csv"] } },
      { id: "s-flaw", type: "spot_the_flaw", title: "Audit", objective_refs: ["c-kin"], concept_refs: ["c-kin"], estimated_seconds: 0, adaptation_hooks: [],
        flawed_content: "AUTHORED placeholder reading (should be replaced).",
        claims: [{ id: "authored", text: "authored", flaws_expected: ["AUTHORED_CUE_NEVER_MATCHED"] }],
        model_correction: "authored correction.", rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
        reference_from_run: "demo-decay-fit", regenerate_from_run: true },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-28T00:00:00Z",
  };
}

// A realistic attested run: it produces the manifest's declared output and reports the declared check.
const PASS = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457",
  artifacts: ["outputs/stats.csv"], checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
};

describe("per-run flaw regeneration", () => {
  it("regenerates the spot_the_flaw from the learner's run; answer key stays server-side", async () => {
    const d = mkdtempSync(join(tmpdir(), "regen-"));
    writeFileSync(join(d, "regen.json"), JSON.stringify(regenBundle()));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false, judgmentGenerator: new StubJudgmentGenerator() });
      const { sessionId } = await host.create("regen.json", "op");
      const r = await host.ingestRunResult(sessionId, PASS);
      expect(r.status).toBe("ran");

      // server-side scene is now the REGENERATED reading (anchored on the learner's landmark), not authored
      const scene = host.currentPresentation(sessionId).scene as { type: string; flawed_content: string; claims: Array<{ id: string }> };
      expect(scene.type).toBe("spot_the_flaw");
      expect(scene.flawed_content).toContain("k_fit=0.4212");
      expect(scene.flawed_content).not.toContain("AUTHORED placeholder");
      expect(scene.claims.some((c) => c.id === "f-unit")).toBe(true);   // regenerated answer key
      expect(scene.claims.some((c) => c.id === "authored")).toBe(false); // authored one replaced

      // ...but the answer key stays SERVER-SIDE — the client projection strips claims + model_correction
      const pub = JSON.stringify(publicPresentation(host.currentPresentation(sessionId)));
      expect(pub).toContain("k_fit=0.4212");   // the regenerated flawed reading IS shown (it's the task)
      expect(pub).not.toContain("model_correction");
      expect(pub).not.toContain("f-unit");

      // grading uses the REGENERATED claims (stub flaws: unites / demi-vie) -> feeds trust_calibration
      await host.respond(sessionId, { kind: "flaw_report", text: "k a des unites (1/temps), pas sans dimension ; demi-vie courte" });
      const cs = (host.getState(sessionId) as { concept_states: Record<string, { trust_calibration_samples?: number }> }).concept_states["c-kin"];
      expect(cs?.trust_calibration_samples).toBeGreaterThanOrEqual(1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("WITHOUT a generator, the authored (deterministic) flaws stand — no regeneration", async () => {
    const d = mkdtempSync(join(tmpdir(), "regen-"));
    writeFileSync(join(d, "regen.json"), JSON.stringify(regenBundle()));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false }); // no judgmentGenerator
      const { sessionId } = await host.create("regen.json", "op");
      await host.ingestRunResult(sessionId, PASS);
      const scene = host.currentPresentation(sessionId).scene as { flawed_content: string };
      expect(scene.flawed_content).toContain("AUTHORED placeholder"); // unchanged
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("QUARANTINE: a theatre run (empty artifacts/checks) advances but never grounds the judgment", async () => {
    const d = mkdtempSync(join(tmpdir(), "regen-"));
    writeFileSync(join(d, "regen.json"), JSON.stringify(regenBundle()));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false, judgmentGenerator: new StubJudgmentGenerator() });
      const { sessionId } = await host.create("regen.json", "op");
      // ran && passed, but produces none of the manifest's declared outputs/checks — theatre.
      const THEATRE = { ran: true, passed: true, landmark: "k_fit=0.4212", artifacts: [], checks: [] };
      const r = await host.ingestRunResult(sessionId, THEATRE);
      expect(r.status).toBe("ran");             // still advances (the pure-delegation gate is ran && passed)
      expect(r.attested).toBe(false);           // but attestation fails
      expect(r.learnerRunRecorded).toBe(false); // so the run never grounds a judgment (no trust feed)
      expect(r.attestationReasons.length).toBeGreaterThan(0);
      // the downstream judgment stays AUTHORED — no regeneration on an unverifiable run
      const scene = host.currentPresentation(sessionId).scene as { flawed_content: string };
      expect(scene.flawed_content).toContain("AUTHORED placeholder");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
