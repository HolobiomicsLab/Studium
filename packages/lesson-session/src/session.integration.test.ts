import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";
import type { ResponseInput, Transition } from "./types.js";

type Step = { respond?: ResponseInput; turns?: string[] };

const bundle = LessonBundleSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/all-scene-types.json", import.meta.url)), "utf8")));
const script = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/scripts/all-types-happy.json", import.meta.url)), "utf8")) as Step[];

describe("full playthrough (all scene types, stub LLM)", () => {
  it("completes the lesson and emits the expected event family", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle, deps);
    await s.start();
    let last: Transition | null = null;
    for (const step of script) {
      if (step.turns) for (const t of step.turns) await s.submitTurn(t);
      if (step.respond) last = await s.respond(step.respond);
    }
    expect(last?.kind).toBe("complete");
    if (last?.kind === "complete") expect(last.summary.scenesCompleted).toBeGreaterThanOrEqual(8);
    const types = new Set((deps.telemetry as InMemoryTelemetrySink).events.map((e) => e.type));
    for (const t of ["lesson_started", "scene_entered", "quiz_answered", "critique_submitted", "ai_audit_result", "reasoning_signal", "scene_completed", "lesson_completed"]) {
      expect(types.has(t)).toBe(true);
    }
  });
});
