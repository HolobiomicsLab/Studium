// RT-8: time on scene is measured by the session clock (scene entry → answer) instead of a constant 0,
// so `time_on_scene` reaches the rules as a real number; and `quiz_answered` carries the learner's own
// per-answer confidence when they gave one, instead of a constant 0.5.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";
import type { Clock } from "./ports.js";

/** A clock that only moves when the test moves it. */
class ManualClock implements Clock {
  constructor(public ms = Date.parse("2026-10-30T09:00:00.000Z")) {}
  now(): string { return new Date(this.ms).toISOString(); }
  advance(seconds: number): void { this.ms += seconds * 1000; }
}

const base = (id: string, type: string) => ({
  id, type, title: id, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
});
const quiz = (id: string) => ({
  ...base(id, "quiz"), question: "?", feedback_correct: "ok", feedback_incorrect: "no", hints: [],
  choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
});
function bundle(scenes: object[], rules: object[] = []): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "timing", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: "c", title: "c", description: "d", bloom_level_target: "understand" }],
    scenes, rules, validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
  } as unknown as LessonBundle;
}

describe("time on scene", () => {
  it("is the clock delta between entering the scene and answering it", async () => {
    const clock = new ManualClock();
    const telemetry = new InMemoryTelemetrySink();
    const session = new LessonSession(bundle([quiz("q1"), { ...base("i", "intro"), markdown: "m" }]), buildTestDeps({ clock, telemetry }));
    await session.start();
    clock.advance(42);
    await session.respond({ kind: "quiz_choice", choiceId: "b" });
    const answer = session.getState().history.find((entry) => entry.signal.kind === "answer_submitted")?.signal;
    expect(answer).toMatchObject({ time_ms: 42_000 });
    expect(telemetry.events.find((event) => event.type === "quiz_answered")).toMatchObject({ response_time_ms: 42_000 });
    expect(telemetry.events.find((event) => event.type === "scene_completed" && event.scene_id === "q1")).toMatchObject({ duration_ms: 42_000 });

    clock.advance(5);
    await session.respond({ kind: "ack" });
    expect(telemetry.events.find((event) => event.type === "scene_completed" && event.scene_id === "i")).toMatchObject({ duration_ms: 5_000 });
  });

  it("restarts on a replay of the same scene: the second attempt is timed from the first answer", async () => {
    const replay = { id: "retry", when: { answer_correct: "==false" }, action: { kind: "replay_current_scene", reason: "again" }, modulator: "M1", explanation_short: "again" };
    const clock = new ManualClock();
    const session = new LessonSession(bundle([quiz("q1")], [replay]), buildTestDeps({ clock }));
    await session.start();
    clock.advance(10);
    expect((await session.respond({ kind: "quiz_choice", choiceId: "a" })).kind).toBe("replay");
    clock.advance(3);
    await session.respond({ kind: "quiz_choice", choiceId: "b" });
    const answers = session.getState().history.map((entry) => entry.signal).filter((signal) => signal.kind === "answer_submitted");
    expect(answers.map((signal) => (signal as { time_ms: number }).time_ms)).toEqual([10_000, 3_000]);
  });

  it("reaches a rule as a real number: a `time_on_scene < 5` rule fires on a hasty answer only", async () => {
    const rule = { id: "too_fast", when: { time_on_scene: "<5" }, action: { kind: "replay_current_scene", reason: "slow down" }, modulator: "M1", explanation_short: "slow down" };
    const play = async (seconds: number) => {
      const clock = new ManualClock();
      const session = new LessonSession(bundle([quiz("q1"), quiz("q2")], [rule]), buildTestDeps({ clock }));
      await session.start();
      clock.advance(seconds);
      return session.respond({ kind: "quiz_choice", choiceId: "b" });
    };
    // Before RT-8 every grader sent time_ms 0, so this rule fired on EVERY answer, the slow one too.
    expect((await play(2)).navigation?.rule_id).toBe("too_fast");
    expect((await play(42)).navigation?.rule_id).toBeNull();
  });
});

describe("quiz_answered confidence", () => {
  it("carries the learner's own per-answer rating (0..4 → 0..1)", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const session = new LessonSession(bundle([quiz("q1")]), buildTestDeps({ telemetry }));
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "b", confidence: 3 });
    expect(telemetry.events.find((event) => event.type === "quiz_answered")).toMatchObject({ confidence: 0.75 });
  });


  it("omits the confidence when the learner did not rate (I-5), instead of a made-up 0.5", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const session = new LessonSession(bundle([quiz("q1")]), buildTestDeps({ telemetry }));
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "b" });
    const answered = telemetry.events.find((event) => event.type === "quiz_answered");
    expect(answered).toBeDefined();
    expect(answered).not.toHaveProperty("confidence");
  });
});
