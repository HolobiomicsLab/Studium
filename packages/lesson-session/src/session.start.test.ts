import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultLearnerState } from "@studium/learner-state";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";

const bundle = {
  schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
  metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
  concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { id: "s0", type: "intro", title: "Intro", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "# hi" },
    { id: "s1", type: "concept", title: "Concept", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [], markdown: "## body" },
  ],
  rules: [], validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
} as unknown as LessonBundle;

describe("LessonSession.start", () => {
  it("emits lesson_started + scene_entered, returns first presentation", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle, deps);
    const p = await s.start();
    expect(p.index).toBe(0);
    expect(p.total).toBe(2);
    expect(p.scene.id).toBe("s0");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.map((e) => e.type)).toEqual(["lesson_started", "scene_entered"]);
    expect(sink.events[1]).toMatchObject({ scene_id: "s0", scene_type: "intro" });
  });
  it("currentPresentation before start throws", () => {
    const s = new LessonSession(bundle, buildTestDeps());
    expect(() => s.currentPresentation()).toThrow(/not started/);
  });

  it("resumes at the first bundle scene not already completed", async () => {
    const state = defaultLearnerState(bundle.bundle_id);
    state.scenes_completed = ["s0"];
    const deps = buildTestDeps();

    const presentation = await new LessonSession(bundle, deps, state).start();

    expect(presentation.index).toBe(1);
    expect(presentation.scene.id).toBe("s1");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    expect(sink.events.at(-1)).toMatchObject({ type: "scene_entered", scene_id: "s1" });
  });

  it("starts a completed lesson at scene zero for a retake", async () => {
    const state = defaultLearnerState(bundle.bundle_id);
    state.scenes_completed = bundle.scenes.map((scene) => scene.id);

    const presentation = await new LessonSession(bundle, buildTestDeps(), state).start();

    expect(presentation.index).toBe(0);
    expect(presentation.scene.id).toBe("s0");
  });

  it("starts a profile-completed lesson at scene zero even when its bundle state is partial", async () => {
    const state = defaultLearnerState(bundle.bundle_id);
    state.scenes_completed = ["s0"];

    const presentation = await new LessonSession(bundle, buildTestDeps(), state, "learner", true).start();

    expect(presentation.index).toBe(0);
    expect(presentation.scene.id).toBe("s0");
  });
});
