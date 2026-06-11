// packages/lesson-session-host/src/host.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
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

/** Two-quiz bundle: no intro, same concept on both quizzes.
 * Two correct answers (difficulty 0.5, 0 hints) take α from 1 to 4, β stays 1 → mastery = 4/5 = 0.8.
 * The second quiz returns {kind:"complete"} and triggers mastery-claim emission. */
const MASTERY_BUNDLE = {
  schema_version: "1.4", bundle_id: "mastery-test-001", source_plan_id: "p",
  metadata: { title: "Mastery", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "q1", type: "quiz", title: "Q1", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
    { id: "q2", type: "quiz", title: "Q2", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
};
function masteryBundlesDir(): string { const d = mkdtempSync(join(tmpdir(), "host-mastery-")); dirs.push(d); writeFileSync(join(d, "mastery.json"), JSON.stringify(MASTERY_BUNDLE)); return d; }

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

describe("SessionHost — mastery sink flush on completion", () => {
  it("writes the .jsonld file when FileMasteryClaimSink is wired and the lesson completes", async () => {
    const masteryDir = mkdtempSync(join(tmpdir(), "host-mastery-out-"));
    dirs.push(masteryDir);
    const prev = process.env["STUDIUM_MASTERY_DIR"];
    process.env["STUDIUM_MASTERY_DIR"] = masteryDir;
    try {
      const host = new SessionHost({ bundlesRoot: masteryBundlesDir(), live: false });
      const { sessionId } = await host.create("mastery.json");
      // First correct quiz — advances to q2, mastery ~0.714 (not yet at threshold)
      const t1 = await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      expect(t1.kind).toBe("next");
      // Second correct quiz — session completes, mastery = 0.8 ≥ threshold
      const t2 = await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      expect(t2.kind).toBe("complete");
      // The FileMasteryClaimSink.flush() must have been called: a .jsonld file should exist
      const files = readdirSync(masteryDir).filter(f => f.endsWith(".jsonld"));
      expect(files.length).toBeGreaterThan(0);
      const raw = readFileSync(join(masteryDir, files[0]!), "utf8");
      const doc = JSON.parse(raw) as { "@graph": Array<Record<string, unknown>> };
      const claim = doc["@graph"].find(n => n["@type"] === "asb:Claim");
      expect(claim).toBeDefined();
      expect((claim as any).relation).toBe("demonstrates mastery of");
    } finally {
      if (prev === undefined) delete process.env["STUDIUM_MASTERY_DIR"];
      else process.env["STUDIUM_MASTERY_DIR"] = prev;
    }
  });
});
