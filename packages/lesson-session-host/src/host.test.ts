// packages/lesson-session-host/src/host.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, SessionHostNotFoundError } from "./host.js";

const MINI = {
  schema_version: "1.4", bundle_id: "mini-001", source_plan_id: "p",
  metadata: { title: "M", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "I", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
    { id: "s1", type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-06-10T08:00:00Z",
};
const dirs: string[] = [];
function bundlesDir(): string { const d = mkdtempSync(join(tmpdir(), "host-")); dirs.push(d); writeFileSync(join(d, "mini.json"), JSON.stringify(MINI)); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("SessionHost", () => {
  it("creates a session and advances via respond", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId, presentation } = await host.create("mini.json");
    expect(presentation.scene.id).toBe("s0");
    const t = await host.respond(sessionId, { kind: "ack" });
    expect(t.kind).toBe("next");
    expect(host.getState(sessionId).lesson_id).toBe("mini-001");
  });
  it("throws SessionHostNotFoundError for unknown id", () => {
    const host = new SessionHost({ bundlesRoot: ".", live: false });
    expect(() => host.currentPresentation("nope")).toThrow(SessionHostNotFoundError);
  });
  it("forget emits forget_requested then drops the session", async () => {
    const host = new SessionHost({ bundlesRoot: bundlesDir(), live: false });
    const { sessionId } = await host.create("mini.json");
    await host.forget(sessionId);
    expect(host.has(sessionId)).toBe(false);
  });
});
