import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { SessionWorkspace } from "./session-workspace.js";
import { operatorContext, responseFor } from "./operator-context.js";
import { ResponseInputSchema } from "./response-input-schema.js";
import { RunResultSchema } from "./run-result.js";

const dirs: string[] = [];
const scene = {
  id: "inspect", type: "quiz", title: "Compare spectra", concept_refs: ["c"],
  objective_refs: [], estimated_seconds: 60, adaptation_hooks: [], question: "What changed?",
  choices: [{ id: "a", text: "The precursor", correct: true }, { id: "b", text: "Nothing", correct: false }],
  feedback_correct: "PRIVATE-FEEDBACK", feedback_incorrect: "PRIVATE-CORRECTION",
  hints: ["PRIVATE-HINT"],
  render_assets: [{ kind: "data_csv", title: "Peaks", payload: "mz,intensity\n100,1", meta: { model_answer: "PRIVATE-ASSET" } }],
};

async function start(overrides: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "operator-context-")); dirs.push(dir);
  await writeFile(join(dir, "lesson.json"), JSON.stringify({
    schema_version: "1.4", bundle_id: "operator-test", source_plan_id: "plan",
    metadata: { title: "Spectra", target: "M2", duration_minutes: 5, language: "en", discipline: "Chemistry" },
    concepts: [{ id: "c", title: "Evidence", description: "Evidence", bloom_level_target: "evaluate" }],
    scenes: [{ ...scene, ...overrides }], rules: [], validated_by: "test-teacher", validated_at: "2026-09-10T00:00:00Z",
  }));
  const host = new SessionHost({ bundlesRoot: dir, live: false });
  const { sessionId } = await host.create("lesson.json", "test");
  return { dir, host, sessionId };
}
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("public operator context", () => {
  it.each(["intro", "quiz", "meta_checkpoint", "ai_critique", "spot_the_flaw", "explain_back", "comparison", "summary_audit", "prompt_practice", "communication_sim"])("supplies a canonical payload example for %s", type => {
    const response = responseFor({ type }, false);
    expect(ResponseInputSchema.safeParse(response.example).success).toBe(true);
    expect(response.instructions).toContain("do not submit this example");
    expect(response.example).not.toHaveProperty("confidence");
  });
  it("supplies deck and unexecuted-run examples without a fabricated success", () => {
    const response = responseFor({ type: "spot_the_flaw", deck: [{ token: "d0", text: "Public claim" }] }, false);
    expect(response.kind).toBe("flaw_verdicts");
    expect(ResponseInputSchema.safeParse(response.example).success).toBe(true);
    const run = responseFor({ type: "reproduction" }, true);
    expect(RunResultSchema.safeParse(run.example).success).toBe(true);
    expect(run.example.ran).toBe(false);
  });
  it("provides display materials and response shape without feedback, keys or arbitrary metadata", async () => {
    const { host, sessionId } = await start();
    const original = JSON.stringify(host.currentPresentation(sessionId));
    const result = operatorContext(host, sessionId);
    expect(result.schema).toBe("studium/operator-context/v1");
    expect(result.scene.question).toBe("What changed?");
    expect(result.scene_assets[0]?.payload).toContain("100,1");
    expect(result.response.kind).toBe("quiz_choice");
    expect(result.rendering.instructions).toContain("learner");
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(JSON.stringify(result.scene.choices)).not.toContain("correct");
    expect(JSON.stringify(host.currentPresentation(sessionId))).toBe(original);
  });

  it("embeds the same current context in the file task without adding protocol files", async () => {
    const { dir, host, sessionId } = await start();
    await new SessionWorkspace(host, dir).writeStep(sessionId);
    const task = await readFile(join(dir, "task.md"), "utf8");
    const match = task.match(/<!-- studium-operator-context -->\n```json\n([\s\S]*?)\n```/);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual(operatorContext(host, sessionId));
    expect(task).not.toContain("PRIVATE-");
  });

  it("withholds the author measurement during a learner run", async () => {
    const { host, sessionId } = await start({
      type: "reproduction", task_card_id: "task", prompt: "Run the experiment",
      steps: [{ step_id: "1", instruction: "Run the experiment", expected_input_schema: { type: "object" }, expected_output: "match.json" }],
      run_manifest: { capsule_ref: "capsule", cmd: ["python", "run.py"], expected_outputs: ["match.json"], verify_checks: ["file exists: match.json"] },
      reference_result: { ran: true, passed: true, figure_path: "PRIVATE-FIGURE.png", landmark: "PRIVATE-LANDMARK", checks: [], provenance: { cmd: ["python", "run.py"], capsule_doi: "PRIVATE-DOI", env: "PRIVATE-ENV" } },
    });
    const result = operatorContext(host, sessionId);
    expect(result.response.kind).toBe("run_result");
    expect(result.run_manifest?.cmd).toEqual(["python", "run.py"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(result.scene_assets.some(a => a.kind === "executed_result")).toBe(false);
  });
});
