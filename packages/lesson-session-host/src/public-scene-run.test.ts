// Redaction parity for LEARNER-TIME RUN scenes: a scene carrying a run_manifest WITHHOLDS its author
// executed run (the learner must produce a fresh result) — over both the publicScene transport (MCP
// get_current_scene) and host.sceneArtifacts (MCP get_scene_artifacts).
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicScene } from "./public-scene.js";
import { SessionHost } from "./host.js";

const AUTHOR_RUN = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", figure_path: "figures/decay.png",
  checks: [], provenance: { capsule_doi: "10.0000/demo", cmd: [], env: "author" },
};
const MANIFEST = { capsule_ref: "fixtures/capsule-demo", cmd: ["python", "run.py"], expected_outputs: ["o"], verify_checks: ["c"] };

describe("publicScene — withhold the author run on a learner-time run scene", () => {
  it("drops reference_result when run_manifest is present (the learner produces a fresh result)", () => {
    const runScene = {
      id: "s", type: "reproduction", title: "R", objective_refs: [], concept_refs: [], estimated_seconds: 0, adaptation_hooks: [],
      task_card_id: "tc", steps: [{ step_id: "1", instruction: "x", expected_input_schema: {}, expected_output: "y" }],
      run_manifest: MANIFEST, reference_result: AUTHOR_RUN,
    };
    const pub = publicScene(runScene as never) as Record<string, unknown>;
    expect("run_manifest" in pub).toBe(true);          // the manifest IS shipped (non-answer-bearing)
    expect("reference_result" in pub).toBe(false);     // the AUTHOR run is withheld
    expect(JSON.stringify(pub)).not.toContain("k_fit=0.4212");
  });

  it("keeps reference_result on a spot_the_flaw (no run_manifest) — it is the evidence to audit", () => {
    const flaw = {
      id: "f", type: "spot_the_flaw", title: "F", objective_refs: [], concept_refs: [], estimated_seconds: 0, adaptation_hooks: [],
      flawed_content: "x", claims: [{ id: "k", text: "t", flaws_expected: ["u"] }], model_correction: "y",
      rubric: { completeness: 1, evidence_quality: 0, tone: 0 }, reference_result: AUTHOR_RUN,
    };
    const pub = publicScene(flaw as never) as Record<string, unknown>;
    expect("reference_result" in pub).toBe(true);      // the run IS the evidence the learner reasons from
    expect("claims" in pub).toBe(false);               // ...but the answer key is stripped
    expect("model_correction" in pub).toBe(false);
  });
});

describe("host.sceneArtifacts — withhold the author executed_result on a run scene", () => {
  it("filters the executed_result asset when the current scene has a run_manifest", async () => {
    const bundle = {
      schema_version: "1.4", bundle_id: "run-art", source_plan_id: "p",
      metadata: { title: "T", target: "g", duration_minutes: 5, language: "fr", discipline: "x" },
      concepts: [{ id: "c1", title: "C", description: "d", bloom_level_target: "apply" }],
      scenes: [{
        id: "s0", type: "reproduction", title: "R", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0,
        adaptation_hooks: [], task_card_id: "tc",
        steps: [{ step_id: "1", instruction: "x", expected_input_schema: { type: "object" }, expected_output: "y" }],
        run_manifest: MANIFEST, reference_result: AUTHOR_RUN,
      }],
      rules: [], validated_by: "teacher", validated_at: "2026-06-28T00:00:00Z",
    };
    const d = mkdtempSync(join(tmpdir(), "runart-"));
    try {
      writeFileSync(join(d, "b.json"), JSON.stringify(bundle));
      const host = new SessionHost({ bundlesRoot: d, live: false });
      const { sessionId } = await host.create("b.json", "op");
      const assets = host.sceneArtifacts(sessionId);
      expect(assets.some((a) => a.kind === "executed_result")).toBe(false); // author run withheld on a run scene
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
