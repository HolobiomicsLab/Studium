import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import type { CompletionSummary } from "./types.js";

// A quiz scene on concept c1: choice "a" wrong, "b" correct. `hints` optionally populated so
// requestHint() has something to dispense (each hint is a scaffolding event).
function quizScene(id: string, hints: string[] = []) {
  return {
    id, type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints,
  };
}

// Fires replay_current_scene once a concept accumulates 2 consecutive wrong answers — this is the
// canonical scaffolding (remediation replay) trajectory the eval personas exercise.
const replayRule = {
  id: "rule_2err", when: { consecutive_errors_same_concept: ">=2" },
  action: { kind: "replay_current_scene", reason: "errors_threshold" },
  modulator: "M1", explanation_short: "revoir",
};

function bundleWith(scenes: unknown[], rules: unknown[] = []): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
    scenes, rules, validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
  } as unknown as LessonBundle;
}

// Walk a session to completion by ack-ing/answering scenes correctly until kind:complete, then
// return the CompletionSummary. The caller pre-seeds any scaffolding (replays/hints) before calling.
async function answerCorrectlyToCompletion(s: LessonSession): Promise<CompletionSummary> {
  for (let i = 0; i < 50; i++) {
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" });
    if (t.kind === "complete") return t.summary;
  }
  throw new Error("session did not complete within 50 turns");
}

describe("LessonSession.complete — autonomyRatio reflects scaffolding dependence", () => {
  it("(a) clean completion with NO scaffolding → autonomyRatio === 1.0", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1"), quizScene("q2")]), deps);
    await s.start();
    const summary = await answerCorrectlyToCompletion(s);
    expect(summary.autonomyRatio).toBe(1);
  });

  it("(b-replay) a completion that consumed REPLAYS → autonomyRatio strictly < 1.0", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1"), quizScene("q2")], [replayRule]), deps);
    await s.start();
    // Two consecutive wrong answers on q1 trip the replay rule (a scaffolding event), then recover.
    await s.respond({ kind: "quiz_choice", choiceId: "a" });
    const replayT = await s.respond({ kind: "quiz_choice", choiceId: "a" });
    expect(replayT.kind).toBe("replay");
    const summary = await answerCorrectlyToCompletion(s);
    expect(summary.autonomyRatio).toBeLessThan(1);
    expect(summary.autonomyRatio).toBeGreaterThanOrEqual(0);
  });

  it("(b-hints) a completion that consumed HINTS → autonomyRatio strictly < 1.0", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1", ["hint A", "hint B"]), quizScene("q2")]), deps);
    await s.start();
    const hint = s.requestHint();
    expect(hint).not.toBeNull();
    const summary = await answerCorrectlyToCompletion(s);
    expect(summary.autonomyRatio).toBeLessThan(1);
    expect(summary.autonomyRatio).toBeGreaterThanOrEqual(0);
  });

  it("(b-monotone) MORE scaffolding ⇒ LOWER (or equal-and-never-higher) autonomyRatio", async () => {
    // clean run
    const cleanDeps = buildTestDeps();
    const clean = new LessonSession(bundleWith([quizScene("q1"), quizScene("q2")]), cleanDeps);
    await clean.start();
    const cleanRatio = (await answerCorrectlyToCompletion(clean)).autonomyRatio;

    // one hint
    const oneDeps = buildTestDeps();
    const oneHint = new LessonSession(bundleWith([quizScene("q1", ["h1", "h2"]), quizScene("q2")]), oneDeps);
    await oneHint.start();
    oneHint.requestHint();
    const oneHintRatio = (await answerCorrectlyToCompletion(oneHint)).autonomyRatio;

    // a replay AND a hint (heavy scaffolding personas lean on both)
    const heavyDeps = buildTestDeps();
    const heavy = new LessonSession(bundleWith([quizScene("q1", ["h1", "h2"]), quizScene("q2")], [replayRule]), heavyDeps);
    await heavy.start();
    heavy.requestHint();                                   // 1 hint on q1
    await heavy.respond({ kind: "quiz_choice", choiceId: "a" });
    const r = await heavy.respond({ kind: "quiz_choice", choiceId: "a" }); // trips replay
    expect(r.kind).toBe("replay");
    const heavyRatio = (await answerCorrectlyToCompletion(heavy)).autonomyRatio;

    expect(cleanRatio).toBe(1);
    expect(oneHintRatio).toBeLessThan(cleanRatio);
    expect(heavyRatio).toBeLessThan(oneHintRatio);
  });

  it("autonomyRatio stays within [0,1]", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1", ["h1", "h2"]), quizScene("q2")], [replayRule]), deps);
    await s.start();
    s.requestHint();
    await s.respond({ kind: "quiz_choice", choiceId: "a" });
    await s.respond({ kind: "quiz_choice", choiceId: "a" });
    const summary = await answerCorrectlyToCompletion(s);
    expect(summary.autonomyRatio).toBeGreaterThanOrEqual(0);
    expect(summary.autonomyRatio).toBeLessThanOrEqual(1);
  });
});
