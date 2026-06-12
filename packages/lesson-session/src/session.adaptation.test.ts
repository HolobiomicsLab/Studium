import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";

// quiz scene factory (concept c1) with choice "a" wrong, "b" correct
function quizScene(id: string) {
  return { id, type: "quiz", title: "Q", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

const replayRule = { id: "rule_2err", when: { consecutive_errors_same_concept: ">=2" }, action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: "revoir" };

function bundleWith(scenes: unknown[], rules: unknown[]): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }, { id: "c2", title: "C2", description: "d", bloom_level_target: "understand" }],
    scenes, rules, validated_by: "teacher", validated_at: "2026-05-08T10:00:00Z",
  } as unknown as LessonBundle;
}

const skipRuleC1Only = { id: "rule_skip", when: { mastery_c: ">=0", total_attempts: ">=1" }, action: { kind: "skip_to_next_concept" }, modulator: "M1", explanation_short: "skip" };

describe("LessonSession.respond — adaptation branches", () => {
  it("skip_to_next_concept with no later different-concept scene falls through to advance", async () => {
    // Two quiz scenes BOTH concept "c1" — skip_to_next_concept has no target, falls through to advance
    const deps = buildTestDeps();
    const s = new LessonSession(
      bundleWith([quizScene("q1"), quizScene("q2")], [skipRuleC1Only]),
      deps,
    );
    await s.start();
    // Answer scene 0 (q1); rule fires (mastery_c>=0 + total_attempts>=1) → skip_to_next_concept
    // No later scene with a different concept → fall through → advance to q2
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" });
    expect(t.kind).toBe("next");
    if (t.kind === "next") expect(t.presentation.scene.id).toBe("q2");
  });

  // M3 calibration scenes: a quiz on c1 followed by a meta_checkpoint on c1, plus a trailing scene
  // so the meta turn can advance (not just complete). The calibration rule keys on c1's mastery
  // accumulated from the quiz turn.
  function metaScene(id: string) {
    return { id, type: "meta_checkpoint", title: "Auto-éval", objective_refs: [], concept_refs: ["c1"],
      estimated_seconds: 0, adaptation_hooks: ["rule_calibration_mismatch_show"],
      pre_question: "p", post_question: "q", scale_labels: ["1", "2", "3", "4", "5"] };
  }
  const calibRule = { id: "rule_calibration_mismatch_show",
    when: { confidence_calibration_abs: ">=0.4", total_attempts: ">=3" },
    action: { kind: "show_calibration_panel" }, modulator: "M3",
    explanation_short: "Compare ta confiance et ta réussite." };

  // Drive a quiz→quiz→quiz→meta trajectory: 3 WRONG quiz answers (mastery stays low ~0.28, 3 attempts),
  // then declare `confidence` at the meta_checkpoint. Returns the meta-turn transition + telemetry.
  async function runWrongThenConfidence(confidenceValue: 0 | 1 | 2 | 3 | 4) {
    const deps = buildTestDeps();
    const s = new LessonSession(
      bundleWith([quizScene("q1"), quizScene("q2"), quizScene("q3"), metaScene("m1"), quizScene("q4")], [calibRule]),
      deps,
    );
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // wrong → 3 attempts on c1, low mastery
    const t = await s.respond({ kind: "confidence", value: confidenceValue });
    return { t, deps };
  }

  it("M3 PERSONA-COLLAPSE RESOLVED: overconfident (declare 4 + wrong) DIVERGES from low-confidence (declare 1 + wrong)", async () => {
    const over = await runWrongThenConfidence(4);   // overconfident
    const under = await runWrongThenConfidence(1);   // calibrated-low / struggling

    // (1) Trajectory diverges at the meta_checkpoint
    expect(over.t.kind).toBe("calibration");
    expect(under.t.kind).not.toBe("calibration");
    expect(over.t.kind).not.toBe(under.t.kind);
    if (over.t.kind === "calibration") expect(over.t.targetConcept).toBe("c1");

    // (2) Only the overconfident persona emits an M3 adaptation_applied event
    const overApplied = (over.deps.telemetry as InMemoryTelemetrySink).events
      .filter((e) => e.type === "adaptation_applied" && (e as any).modulator === "M3");
    const underApplied = (under.deps.telemetry as InMemoryTelemetrySink).events
      .filter((e) => e.type === "adaptation_applied" && (e as any).modulator === "M3");
    expect(overApplied.length).toBeGreaterThanOrEqual(1);
    expect(overApplied.at(-1)).toMatchObject({ rule_id: "rule_calibration_mismatch_show", modulator: "M3" });
    expect(underApplied.length).toBe(0);
  });

  it("M3 confidence_calibration is WRITTEN (non-zero, correct sign) into concept state", async () => {
    const over = await runWrongThenConfidence(4);
    const overState = await over.deps.stateStore.load("L1");
    const overCs = overState?.concept_states["c1"];
    expect(overCs).toBeDefined();
    expect(overCs!.confidence_calibration).toBeGreaterThan(0.4); // overconfident → positive, trips rule

    const under = await runWrongThenConfidence(1);
    const underState = await under.deps.stateStore.load("L1");
    const underCs = underState?.concept_states["c1"];
    expect(underCs).toBeDefined();
    expect(Math.abs(underCs!.confidence_calibration)).toBeLessThan(0.4); // calibrated → near zero
  });

  it("2 consecutive wrong answers → replay_current_scene + adaptation_applied emitted", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundleWith([quizScene("q1"), quizScene("q2")], [replayRule]), deps);
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "a" });          // 1st error
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // 2nd error → replay
    expect(t.kind).toBe("replay");
    // After 1st error at q1 (consecutive_errors=1 → advance_to_next_scene), session advances to q2.
    // 2nd error at q2 brings consecutive_errors_same_concept to 2 → replay fires at q2.
    // Deviation from plan: plan comment says "stays on q1" but the engine advances between errors.
    if (t.kind === "replay") expect(t.presentation.scene.id).toBe("q2");
    const sink = deps.telemetry as InMemoryTelemetrySink;
    const applied = sink.events.filter((e) => e.type === "adaptation_applied");
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.at(-1)).toMatchObject({ rule_id: "rule_2err", modulator: "M1" });
  });

  // ---- Task 1: unseen-item remediation (remediate_alt) ----
  // A quiz scene on an arbitrary concept (choice "a" wrong, "b" correct). Mirrors quizScene above
  // but parameterizes the concept so we can build TWO answer-graded items sharing one concept.
  function quizSceneFor(id: string, concept: string) {
    return { id, type: "quiz", title: "Q", objective_refs: [], concept_refs: [concept], estimated_seconds: 0, adaptation_hooks: [],
      question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }], feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
  }
  // Fire replay_current_scene on the FIRST wrong answer (consecutive_errors=1) so the session stays
  // ON the first c0 item — leaving the second c0 item still UNSEEN when remediation routes.
  const replayOn1Err = { id: "rule_2err_replay_concept", when: { consecutive_errors_same_concept: ">=1" }, action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: "revoir" };

  it("remediates to an UNSEEN alternate item (remediate_alt), not a replay", async () => {
    const deps = buildTestDeps();
    // c0 has TWO answer-graded quiz items; both concept_refs:["c0"]. A trailing c1 item gives the
    // session somewhere to go after, but the remediation must route to the unseen c0 alternate.
    const s = new LessonSession(
      bundleWith([quizSceneFor("s-quiz-c0-1", "c0"), quizSceneFor("s-quiz-c0-2", "c0"), quizScene("q-c1")], [replayOn1Err]),
      deps,
    );
    await s.start();
    // One wrong answer on s-quiz-c0-1 trips rule_2err_replay_concept → replay_current_scene.
    // Runtime routes to the UNSEEN alternate item s-quiz-c0-2 instead of re-presenting s-quiz-c0-1.
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
    expect(t.kind).toBe("remediate_alt");
    if (t.kind === "remediate_alt") expect(t.presentation.scene.id).toBe("s-quiz-c0-2");
  });

  it("falls back to replay when no unseen alternate item exists", async () => {
    const deps = buildTestDeps();
    // c0 has ONLY s-quiz-c0-1 (the trailing item is a DIFFERENT concept c1) → no unseen c0
    // alternate → honest fallback to same-item replay.
    const s = new LessonSession(
      bundleWith([quizSceneFor("s-quiz-c0-1", "c0"), quizScene("q-c1")], [replayOn1Err]),
      deps,
    );
    await s.start();
    const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
    expect(t.kind).toBe("replay");
    if (t.kind === "replay") expect(t.presentation.scene.id).toBe("s-quiz-c0-1");
  });
});
