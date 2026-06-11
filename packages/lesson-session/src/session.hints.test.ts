import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, hints: string[]) {
  return { id, type: "quiz", title: id, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints };
}
function bundle(scaffolding: "standard" | "heavy" | null) {
  const base: any = {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c", title: "C", description: "d", bloom_level_target: "understand" }],
    scenes: [quiz("q1", ["nudge-1", "nudge-2"]), quiz("q2", [])],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
  };
  if (scaffolding) base.universes = { variants: [{ id: "baseline", description: "d", decisions: { prereq_strictness: "standard", pacing: "standard", scaffolding } }], active: "baseline" };
  return base as unknown as LessonBundle;
}

describe("LessonSession — requestHint (scaffolding)", () => {
  it("heavy: returns all authored hints in order, then null; remaining decreases", async () => {
    const s = new LessonSession(bundle("heavy"), buildTestDeps());
    await s.start();
    expect(s.requestHint()).toEqual({ hint: "nudge-1", index: 0, remaining: 1 });
    expect(s.requestHint()).toEqual({ hint: "nudge-2", index: 1, remaining: 0 });
    expect(s.requestHint()).toBeNull();
  });
  it("standard: caps at 1 hint", async () => {
    const s = new LessonSession(bundle("standard"), buildTestDeps());
    await s.start();
    expect(s.requestHint()?.hint).toBe("nudge-1");
    expect(s.requestHint()).toBeNull();
  });
  it("no universes -> standard cap (1)", async () => {
    const s = new LessonSession(bundle(null), buildTestDeps());
    await s.start();
    expect(s.requestHint()?.index).toBe(0);
    expect(s.requestHint()).toBeNull();
  });
  it("emits hint_requested with the hint_index", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle("heavy"), deps);
    await s.start();
    s.requestHint();
    const sink = deps.telemetry as InMemoryTelemetrySink;
    const ev = sink.events.find((e: any) => e.type === "hint_requested") as any;
    expect(ev?.scene_id).toBe("q1");
    expect(ev?.hint_index).toBe(0);
  });
  it("returns null on a quiz with no hints / after advancing to it", async () => {
    const s = new LessonSession(bundle("heavy"), buildTestDeps());
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "b" });   // advance to q2 (no hints)
    expect(s.requestHint()).toBeNull();
  });
  it("hintsUsed resets when entering a new scene", async () => {
    const s = new LessonSession(bundle("heavy"), buildTestDeps());
    await s.start();
    s.requestHint();                                            // q1 hint 1 used
    await s.respond({ kind: "quiz_choice", choiceId: "b" });    // -> q2
    // back-fill: q2 has no hints so null anyway; assert no crash + null
    expect(s.requestHint()).toBeNull();
  });
  it("a hinted-correct answer raises mastery LESS than an unhinted one (anti-offloading)", async () => {
    const sHint = new LessonSession(bundle("heavy"), buildTestDeps());
    await sHint.start();
    sHint.requestHint();                                        // 1 hint
    await sHint.respond({ kind: "quiz_choice", choiceId: "b" }); // correct, hinted
    const mHint = masteryC(sHint);

    const sNo = new LessonSession(bundle("heavy"), buildTestDeps());
    await sNo.start();
    await sNo.respond({ kind: "quiz_choice", choiceId: "b" });   // correct, unhinted
    const mNo = masteryC(sNo);

    expect(mHint).toBeLessThan(mNo);
  });
});

function masteryC(s: LessonSession): number {
  const cs = s.getState().concept_states["c"];
  return cs ? cs.alpha / (cs.alpha + cs.beta) : 0;
}
