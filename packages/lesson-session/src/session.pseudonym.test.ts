import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import { HmacPseudonymProvider } from "./adapters/pseudonym.js";

const bundle = {
  schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
  metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "# hi" },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
} as unknown as LessonBundle;

describe("LessonSession — per-learner salted pseudonym (#4)", () => {
  it("threads (learnerId, lessonId) into PseudonymProvider.get", async () => {
    const calls: Array<[string, string]> = [];
    const deps = buildTestDeps({
      pseudonym: { async get(learnerId: string, lessonId: string) { calls.push([learnerId, lessonId]); return "px"; } },
    });
    await new LessonSession(bundle, deps, undefined, "alice").start();
    expect(calls).toEqual([["alice", "L1"]]);
  });

  it("distinct learners on the SAME lesson stamp DISTINCT pseudonyms onto telemetry", async () => {
    const hmac = new HmacPseudonymProvider("secret");
    const depsA = buildTestDeps({ pseudonym: hmac });
    const depsB = buildTestDeps({ pseudonym: hmac });
    await new LessonSession(bundle, depsA, undefined, "alice").start();
    await new LessonSession(bundle, depsB, undefined, "bob").start();
    const pa = (depsA.telemetry as any).events[0].learner_pseudonym as string;
    const pb = (depsB.telemetry as any).events[0].learner_pseudonym as string;
    expect(pa).not.toBe(pb);
    expect(pa).toHaveLength(16);
  });

  it("defaults learnerId to \"anonymous\" when omitted (backward-compatible)", async () => {
    const calls: Array<[string, string]> = [];
    const deps = buildTestDeps({
      pseudonym: { async get(learnerId: string, lessonId: string) { calls.push([learnerId, lessonId]); return "px"; } },
    });
    await new LessonSession(bundle, deps).start();
    expect(calls).toEqual([["anonymous", "L1"]]);
  });
});
