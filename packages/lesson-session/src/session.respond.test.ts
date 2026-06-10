import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink, InMemoryEventLog } from "./testing.js";

function twoSceneBundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: "s0", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "hi" },
      { id: "s1", type: "concept", title: "Concept", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "body" },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
  } as unknown as LessonBundle;
}

describe("LessonSession.respond — nominal path", () => {
  it("ack on scene 0 advances to scene 1 (kind:next)", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(twoSceneBundle(), deps);
    await s.start();
    const t = await s.respond({ kind: "ack" });
    expect(t.kind).toBe("next");
    if (t.kind === "next") expect(t.presentation.scene.id).toBe("s1");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.map((e) => e.type)).toContain("scene_completed");
  });
  it("ack on last scene completes the lesson (kind:complete)", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(twoSceneBundle(), deps);
    await s.start();
    await s.respond({ kind: "ack" });          // s0 → s1
    const t = await s.respond({ kind: "ack" }); // s1 → complete
    expect(t.kind).toBe("complete");
    if (t.kind === "complete") {
      expect(t.summary.scenesCompleted).toBe(2);
      expect(t.summary.autonomyRatio).toBe(1);
      expect(t.summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    }
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.map((e) => e.type)).toContain("lesson_completed");
  });
  it("persists state + appends an event log record per signal", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(twoSceneBundle(), deps);
    await s.start();
    await s.respond({ kind: "ack" });
    const log = deps.eventLog as InMemoryEventLog;
    expect(log.records.length).toBeGreaterThanOrEqual(1);
    expect(log.records[0]).toMatchObject({ lesson_id: "L1", event_type: "scene_completed" });
  });
  it("respond after complete throws", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(twoSceneBundle(), deps);
    await s.start();
    await s.respond({ kind: "ack" });
    await s.respond({ kind: "ack" });
    await expect(s.respond({ kind: "ack" })).rejects.toThrow(/complete/);
  });
});
