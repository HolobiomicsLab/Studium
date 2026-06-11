// packages/lesson-session-host/src/durable-host.test.ts
// #3 durable + learner-scoped + resumable host: STUDIUM_DATA_DIR gates the File* adapters,
// scoped per (pseudonym, bundle_id). These tests simulate a process restart by constructing a
// FRESH SessionHost over the SAME dataDir and asserting prior LearnerState resumes.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { SessionHost } from "./host.js";

// Three-quiz bundle on one concept (mirrors host.test.ts): three correct answers clear the
// MIN_MASTERY_ATTEMPTS=3 floor so concept_states accumulate real BKT mastery.
function quizScene(id: string) {
  return { id, type: "quiz", title: id.toUpperCase(), objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "y", feedback_incorrect: "n", hints: [] };
}
const MASTERY_BUNDLE_3 = {
  schema_version: "1.4", bundle_id: "mastery-test-003", source_plan_id: "p",
  metadata: { title: "Mastery3", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [quizScene("q1"), quizScene("q2"), quizScene("q3")],
  rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
};

const dirs: string[] = [];
function mastery3BundlesDir(): string {
  const d = mkdtempSync(join(tmpdir(), "durable-bundles-"));
  dirs.push(d);
  writeFileSync(join(d, "mastery3.json"), JSON.stringify(MASTERY_BUNDLE_3));
  return d;
}
function dataDir(): string { const d = mkdtempSync(join(tmpdir(), "durable-data-")); dirs.push(d); return d; }

const SECRET = "durable-test-secret";
const BUNDLE_ID = "mastery-test-003";
function pseudonymOf(learnerId: string, lessonId = BUNDLE_ID): string {
  return createHmac("sha256", SECRET).update(`${learnerId}:${lessonId}`).digest("hex").slice(0, 16);
}

function withDataEnv<T>(data: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prevData = process.env["STUDIUM_DATA_DIR"];
  const prevSecret = process.env["STUDIUM_PSEUDO_SECRET"];
  if (data === undefined) delete process.env["STUDIUM_DATA_DIR"];
  else process.env["STUDIUM_DATA_DIR"] = data;
  process.env["STUDIUM_PSEUDO_SECRET"] = SECRET;
  const restore = () => {
    if (prevData === undefined) delete process.env["STUDIUM_DATA_DIR"];
    else process.env["STUDIUM_DATA_DIR"] = prevData;
    if (prevSecret === undefined) delete process.env["STUDIUM_PSEUDO_SECRET"];
    else process.env["STUDIUM_PSEUDO_SECRET"] = prevSecret;
  };
  return fn().finally(restore);
}

afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("SessionHost — durable + learner-scoped + resumable (#3)", () => {
  it("(a) RESUMES prior LearnerState for the same (learner, lesson) across a process restart", async () => {
    const data = dataDir();
    const bundles = mastery3BundlesDir();
    await withDataEnv(data, async () => {
      // First "process": complete the lesson, accumulating BKT mastery on c1.
      const host1 = new SessionHost({ bundlesRoot: bundles, live: false });
      const { sessionId } = await host1.create("mastery3.json", "alice");
      await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      const done = await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      expect(done.kind).toBe("complete");
      const state1 = host1.getState(sessionId);
      expect(state1.concept_states["c1"]).toBeDefined();
      const attempts1 = state1.concept_states["c1"]!.total_attempts;
      expect(attempts1).toBeGreaterThan(0);

      // Second "process": a FRESH host over the SAME dataDir must RESUME alice's prior state.
      const host2 = new SessionHost({ bundlesRoot: bundles, live: false });
      const r2 = await host2.create("mastery3.json", "alice");
      const state2 = host2.getState(r2.sessionId);
      // concept_states / mastery carry over (longitudinal continuity, not a fresh defaultLearnerState).
      expect(state2.concept_states["c1"]).toBeDefined();
      expect(state2.concept_states["c1"]!.total_attempts).toBe(attempts1);
      expect(state2.scenes_completed.length).toBe(state1.scenes_completed.length);
    });
  });

  it("(b) two distinct learners on the same lesson get SEPARATE durable state, scoped by PSEUDONYM (no raw learnerId on disk)", async () => {
    const data = dataDir();
    const bundles = mastery3BundlesDir();
    await withDataEnv(data, async () => {
      const host = new SessionHost({ bundlesRoot: bundles, live: false });
      const a = await host.create("mastery3.json", "alice");
      await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "b" });
      const b = await host.create("mastery3.json", "bob");
      await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: "b" });

      const aliceP = pseudonymOf("alice");
      const bobP = pseudonymOf("bob");
      expect(aliceP).not.toBe(bobP);
      // Per-pseudonym dirs exist and hold the state file.
      expect(existsSync(join(data, aliceP, BUNDLE_ID, `state-${BUNDLE_ID}.json`))).toBe(true);
      expect(existsSync(join(data, bobP, BUNDLE_ID, `state-${BUNDLE_ID}.json`))).toBe(true);
      // RGPD: the raw learnerId must NEVER appear as a path segment on disk.
      const top = readdirSync(data);
      expect(top).toContain(aliceP);
      expect(top).toContain(bobP);
      expect(top).not.toContain("alice");
      expect(top).not.toContain("bob");
    });
  });

  it("(c) WITHOUT STUDIUM_DATA_DIR (in-memory default), nothing is written and each create() is fresh", async () => {
    const bundles = mastery3BundlesDir();
    await withDataEnv(undefined, async () => {
      const host1 = new SessionHost({ bundlesRoot: bundles, live: false });
      const { sessionId } = await host1.create("mastery3.json", "alice");
      await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      const done = await host1.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      expect(done.kind).toBe("complete");

      // A fresh host (no dataDir) must NOT resume — defaultLearnerState (empty concept_states).
      const host2 = new SessionHost({ bundlesRoot: bundles, live: false });
      const r2 = await host2.create("mastery3.json", "alice");
      const state2 = host2.getState(r2.sessionId);
      expect(Object.keys(state2.concept_states).length).toBe(0);
      expect(state2.scenes_completed.length).toBe(0);
    });
  });

  it("(d) forget() purges the durable per-learner directory (state + event log)", async () => {
    const data = dataDir();
    const bundles = mastery3BundlesDir();
    await withDataEnv(data, async () => {
      const host = new SessionHost({ bundlesRoot: bundles, live: false });
      const { sessionId } = await host.create("mastery3.json", "alice");
      await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      const aliceP = pseudonymOf("alice");
      const scopeDir = join(data, aliceP, BUNDLE_ID);
      expect(existsSync(join(scopeDir, `state-${BUNDLE_ID}.json`))).toBe(true);
      expect(existsSync(join(scopeDir, "events.jsonl"))).toBe(true);

      await host.forget(sessionId);
      expect(host.has(sessionId)).toBe(false);
      // the durable files this learner wrote are gone.
      expect(existsSync(join(scopeDir, `state-${BUNDLE_ID}.json`))).toBe(false);
      expect(existsSync(join(scopeDir, "events.jsonl"))).toBe(false);
    });
  });

  it("(d2) durable mastery .jsonld is co-located under the per-learner dir and erased on forget()", async () => {
    const data = dataDir();
    const bundles = mastery3BundlesDir();
    await withDataEnv(data, async () => {
      const host = new SessionHost({ bundlesRoot: bundles, live: false });
      const { sessionId } = await host.create("mastery3.json", "alice");
      await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      const done = await host.respond(sessionId, { kind: "quiz_choice", choiceId: "b" });
      expect(done.kind).toBe("complete");
      const masteryDir = join(data, pseudonymOf("alice"), BUNDLE_ID, "mastery");
      expect(readdirSync(masteryDir).filter(f => f.endsWith(".jsonld")).length).toBeGreaterThan(0);

      await host.forget(sessionId);
      expect(readdirSync(masteryDir).filter(f => f.endsWith(".jsonld"))).toEqual([]);
    });
  });
});
