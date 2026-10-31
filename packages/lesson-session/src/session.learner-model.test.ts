// RT-2 (bounded) seen through the session: a quiz answer carries its guess rate, so the Beta update
// can correct for guessing; and skip-on-mastery reads EFFECTIVE mastery (posterior × FSRS
// retrievability), so a concept mastered a year ago is reviewed instead of skipped.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultConceptState, defaultLearnerState, type LearnerState } from "@studium/learner-state";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";

const base = (id: string, type: string) => ({
  id, type, title: id, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
});
const quiz = (id: string, correctIds: string[], ids = ["a", "b"]) => ({
  ...base(id, "quiz"), question: "?", feedback_correct: "ok", feedback_incorrect: "no", hints: [],
  choices: ids.map((choice) => ({ id: choice, text: choice.toUpperCase(), correct: correctIds.includes(choice) })),
});
const explainBack = (id: string) => ({
  ...base(id, "explain_back"), prompt: "p", key_points: [{ id: "k", text: "t", cues: ["x"] }],
  model_explanation: "m", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});

function bundle(scenes: object[], skipOnMastery = false): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "model", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: "c", title: "c", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
    learning_workflow_graph: { schema_version: "1.0", course_id: "k", edges: [],
      nodes: [{ id: "concept:c", node_kind: "concept", title: "c", bloom_level: "understand" }] },
    ...(skipOnMastery ? { universes: { active: "baseline", variants: [
      { id: "baseline", description: "d", decisions: { pacing: "skip_on_mastery" } }] } } : {}),
  } as unknown as LessonBundle;
}

const answeredSignal = (session: LessonSession) =>
  session.getState().history.map((entry) => entry.signal).find((signal) => signal.kind === "answer_submitted");

describe("a quiz answer carries the chance of guessing it right", () => {
  it("1/n for a single right choice, k/n for several", async () => {
    for (const [choices, right, expected] of [[["a", "b"], ["b"], 0.5], [["a", "b", "c", "d"], ["b"], 0.25], [["a", "b", "c", "d"], ["a", "b"], 0.5]] as const) {
      const session = new LessonSession(bundle([quiz("q", [...right], [...choices])]), buildTestDeps());
      await session.start();
      await session.respond({ kind: "quiz_choice", choiceId: "a" });
      expect(answeredSignal(session)).toMatchObject({ guess_rate: expected });
    }
  });

  it("a coin-flipper on true/false items ends far below the 0.50 the uncorrected count reads", async () => {
    const scenes = Array.from({ length: 12 }, (_, i) => quiz(`q${i}`, ["b"]));
    const session = new LessonSession(bundle(scenes), buildTestDeps());
    await session.start();
    let last;
    for (let i = 0; i < 12; i++) last = await session.respond({ kind: "quiz_choice", choiceId: i % 2 === 0 ? "b" : "a" });
    expect(last?.kind).toBe("complete");
    const mastery = last?.kind === "complete" ? last.summary.mastery.c : undefined;
    expect(mastery).toBeLessThan(0.15);
  });
});

describe("skip-on-mastery reads effective mastery", () => {
  // Mastered on the posterior (alpha 9, beta 1 → 0.9, three attempts), as the wave-2 W17 test.
  function mastered(memory?: { last_reviewed_at: string; stability: number }): LearnerState {
    const state = defaultLearnerState("model");
    state.concept_states.c = { ...defaultConceptState("c"), alpha: 9, beta: 1, total_attempts: 3, total_correct: 3 };
    if (memory) {
      state.concept_memory = { c: { concept_id: "c", stability: memory.stability, difficulty: 5,
        last_reviewed_at: Date.parse(memory.last_reviewed_at), reps: 2, lapses: 0 } };
    }
    return state;
  }
  const scenes = () => [base("i", "intro"), quiz("q", ["b"]), base("k", "concept"), explainBack("e")]
    .map((scene) => ("markdown" in scene || scene.type === "quiz" || scene.type === "explain_back" ? scene : { ...scene, markdown: "m" }));

  async function nextAfterIntro(state: LearnerState) {
    const session = new LessonSession(bundle(scenes(), true), buildTestDeps(), state);
    await session.start();
    return session.respond({ kind: "ack" });
  }

  it("skips a concept with no FSRS memory on its posterior, as before", async () => {
    const transition = await nextAfterIntro(mastered());
    expect(transition.navigation?.skipped_scene_ids).toEqual(["q", "k"]);
  });

  it("skips a concept reviewed yesterday with a long stability", async () => {
    const transition = await nextAfterIntro(mastered({ last_reviewed_at: "2026-06-09T00:00:00Z", stability: 30 }));
    expect(transition.navigation?.kind).toBe("skip_mastered");
  });

  it("does not skip a concept last reviewed a year ago: its recall has decayed", async () => {
    const transition = await nextAfterIntro(mastered({ last_reviewed_at: "2025-06-10T00:00:00Z", stability: 2 }));
    expect(transition.navigation?.kind).toBe("advance");
    expect(transition.kind === "next" ? transition.presentation.scene.id : null).toBe("q");
  });
});
