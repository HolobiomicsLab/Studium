import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { makeLlmOperator, runStudiumSession, writeResponse, type OperatorCtx } from "./session-runner.js";

const dirs: string[] = [];
function tmp(): string { const dir = mkdtempSync(join(tmpdir(), "runner-recall-")); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("H6 file runner recall", () => {
  it("gives the learner a recall turn before declaring the final production answer complete", async () => {
    const bundlesRoot = tmp();
    const dir = tmp();
    writeFileSync(join(bundlesRoot, "lesson.json"), JSON.stringify({
      schema_version: "1.4", bundle_id: "recall-runner", source_plan_id: "p",
      metadata: { title: "Recall", target: "L1", duration_minutes: 1, language: "en", discipline: "x" },
      concepts: [{ id: "c", title: "C", description: "d", bloom_level_target: "understand" }],
      scenes: [{ id: "explain", type: "explain_back", title: "Explain", objective_refs: [], concept_refs: ["c"],
        estimated_seconds: 30, adaptation_hooks: [], prompt: "Explain it.",
        key_points: [{ id: "k", text: "The source says this.", cues: ["source"] }], model_explanation: "The reference.",
        rubric: { completeness: 1, evidence_quality: 1, tone: 1 } }],
      rules: [], validated_by: "teacher", validated_at: "2026-10-01T00:00:00Z",
    }));
    const host = new SessionHost({ bundlesRoot, live: false, dataDir: null });
    const turns: string[] = [];
    const result = await runStudiumSession(host, "lesson.json", dir, async (_task, ctx) => {
      turns.push(ctx.sceneType);
      await writeResponse(dir, ctx.sceneType === "recall" ? { kind: "recall", grade: "hard" } : { text: "My explanation." });
    }, { maxSteps: 3 });
    expect(turns).toEqual(["explain_back", "recall"]);
    expect(result.completed).toBe(true);
    expect(host.reviewQueue(result.sessionId)).toHaveLength(1);
  });

  it("the model operator refuses to invent a learner recall rating", async () => {
    const dir = tmp();
    const operator = makeLlmOperator({ llm: { complete: async () => "not a rating" }, runCapsule: async () => ({}) });
    await expect(operator("Rate your recall.", { dir, sessionId: "s", sceneType: "recall", step: 1, expects: "response" }))
      .rejects.toThrow(/rating.*learner|learner.*rating/i);
    expect(existsSync(join(dir, "response.json"))).toBe(false);
  });

  it("the model operator passes through an explicitly supplied learner rating", async () => {
    const dir = tmp();
    const ctx: OperatorCtx = { dir, sessionId: "s", sceneType: "recall", step: 1, expects: "response" };
    const calls: OperatorCtx[] = [];
    const operator = makeLlmOperator({
      llm: { complete: async () => { throw new Error("a model must not rate recall"); } },
      runCapsule: async () => ({}),
      recallRating: async (_task: string, received: OperatorCtx) => { calls.push(received); return "hard" as const; },
    });
    await operator("Rate your recall.", ctx);
    expect(calls).toEqual([ctx]);
    expect(JSON.parse(readFileSync(join(dir, "response.json"), "utf8"))).toEqual({ kind: "recall", grade: "hard" });
  });
});
