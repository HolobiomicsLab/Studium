// A REAL LLM-backed operator drives a full run+judgment lesson: it ACTUALLY runs the capsule on the run
// scene (operator owns execution — Studium never does) and calls the LLM to judge the grounded
// spot_the_flaw. Key-free here via a stub LLM + a fake runner; the demo binds a real model + capsule_runner.
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionHost } from "./host.js";
import { runStudiumSession, makeLlmOperator, type OperatorLlm } from "./session-runner.js";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "fixtures");
const BUNDLE = "capsule-loop-demo/lesson.json"; // intro -> reproduction(run_manifest) -> spot_the_flaw(reference_from_run)

describe("makeLlmOperator — LLM-backed operator drives the full run + judgment loop", () => {
  it("runs the capsule on the run scene, LLM-judges the grounded spot_the_flaw, completes + feeds trust", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const dir = mkdtempSync(join(tmpdir(), "studium-llmop-"));

    const llmCalls: string[] = [];
    const llm: OperatorLlm = {
      async complete(prompt) { llmCalls.push(prompt); return "k a des unites (1/temps), pas sans dimension ; la demi-vie vaut ln2/k."; },
    };
    const runCalls: Array<Record<string, unknown>> = [];
    const runCapsule = async (manifest: Record<string, unknown>) => {
      runCalls.push(manifest);
      return { ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", artifacts: ["outputs/stats.csv", "figures/decay.png"], checks: [{ check: "file exists: outputs/stats.csv", passed: true }] };
    };

    const r = await runStudiumSession(host, BUNDLE, dir, makeLlmOperator({ llm, runCapsule }), { maxSteps: 20 });
    expect(r.completed).toBe(true);

    // the operator OWNED execution: it ran the capsule once on the run scene, from the manifest
    expect(runCalls.length).toBe(1);
    expect(runCalls[0]!["cmd"]).toEqual(["python", "scripts/run.py"]);

    // the LLM produced the JUDGMENT for the grounded spot_the_flaw — its prompt carried the learner's OWN
    // landmark (the evidence) but NEVER the answer key
    expect(llmCalls.length).toBe(1);
    expect(llmCalls[0]).toContain("k_fit=0.4212");
    expect(llmCalls[0]).not.toContain("flaws_expected");
    expect(llmCalls[0]).not.toContain("model_correction");

    // judging the grounded reading of the learner's OWN run fed trust_calibration
    const cs = (host.getState(r.sessionId) as { concept_states: Record<string, { trust_calibration_samples?: number }> }).concept_states["c-kinetics"];
    expect(cs?.trust_calibration_samples).toBeGreaterThanOrEqual(1);
  });

  it("falls back to ack on control scenes and never calls the LLM when there's no judgment", async () => {
    const host = new SessionHost({ bundlesRoot: FIXTURES, live: false });
    const dir = mkdtempSync(join(tmpdir(), "studium-llmop-"));
    let llmCalls = 0;
    const llm: OperatorLlm = { async complete() { llmCalls += 1; return "x"; } };
    // a FAILING runner keeps the session on the run scene (self-heal) — assert no LLM call happened yet
    const runCapsule = async () => ({ ran: false, passed: false });
    const r = await runStudiumSession(host, BUNDLE, dir, makeLlmOperator({ llm, runCapsule }), { maxSteps: 4 });
    expect(r.completed).toBe(false);     // never got past the (failing) run scene
    expect(llmCalls).toBe(0);            // the judgment scene was never reached, so the LLM was never called
  });
});
