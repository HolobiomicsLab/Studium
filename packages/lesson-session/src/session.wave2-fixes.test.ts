import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultConceptState, defaultLearnerState } from "@studium/learner-state";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink } from "./testing.js";
import { verdictDeck } from "./grading/deck.js";

function quiz(id: string, concept: string, hints: string[] = []) {
  return {
    id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept],
    estimated_seconds: 0, adaptation_hooks: [], question: "?",
    choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
    feedback_correct: "correct", feedback_incorrect: "incorrect", hints,
  };
}

function intro(id: string, concept: string) {
  return { id, type: "intro", title: id, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 0, adaptation_hooks: [], markdown: "intro" };
}

function concept(id: string, conceptRef: string) {
  return { id, type: "concept", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef], estimated_seconds: 0, adaptation_hooks: [], markdown: "concept" };
}

function explainBack(id: string, conceptRef: string) {
  return {
    id, type: "explain_back", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [], prompt: "explain",
    key_points: [{ id: "k1", text: "authored point", cues: ["alpha"] }],
    model_explanation: "authored model", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
  };
}

function promptPractice(id: string, conceptRef: string) {
  return {
    id, type: "prompt_practice", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [], task: "write", key_points: [{ id: "k1", text: "point", cues: ["alpha"] }],
    model_prompt: "model", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
  };
}

function bundle(
  scenes: object[],
  conceptIds: string[],
  edges: object[] = [],
  rules: object[] = [],
  skipMastered = false,
): LessonBundle {
  const nodes = conceptIds.map((id) => ({ id: `concept:${id}`, node_kind: "concept", title: id, bloom_level: "understand" }));
  return {
    schema_version: "1.4", bundle_id: "wave2", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
    concepts: conceptIds.map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
    scenes, rules, validated_by: "teacher", validated_at: "2026-10-29T00:00:00Z",
    learning_workflow_graph: { schema_version: "1.0", course_id: "c", nodes, edges },
    ...(skipMastered ? { universes: { active: "baseline", variants: [
      { id: "baseline", description: "d", decisions: { pacing: "skip_on_mastery" } },
    ] } } : {}),
  } as unknown as LessonBundle;
}

const prereq = (dependent: string, prerequisite: string, id = `${dependent}-${prerequisite}`) => ({
  id, relation: "prerequisite_for", source: `concept:${dependent}`, target: `concept:${prerequisite}`,
});

function masteredState(conceptId: string) {
  const state = defaultLearnerState("wave2");
  state.concept_states[conceptId] = {
    ...defaultConceptState(conceptId), alpha: 9, beta: 1, total_attempts: 3, total_correct: 3,
  };
  return state;
}

describe("wave-2 routing regressions", () => {
  it("W1 remembers a passed prerequisite and never serves its single quiz again", async () => {
    const deps = buildTestDeps();
    const session = new LessonSession(bundle(
      [quiz("q-base", "base"), concept("c-dep", "dep"), quiz("q-dep", "dep")],
      ["base", "dep"], [prereq("dep", "base")],
    ), deps);
    await session.start();
    const passed = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(passed.navigation?.kind).toBe("gate_passed");
    const advanced = await session.respond({ kind: "ack" });
    expect(advanced.kind === "next" ? advanced.presentation.scene.id : null).toBe("q-dep");
    await session.respond({ kind: "quiz_choice", choiceId: "right" });
    const entered = (deps.telemetry as InMemoryTelemetrySink).events
      .filter((event) => event.type === "scene_entered" && event.scene_id === "q-base");
    expect(entered).toHaveLength(1);
  });

  it("W1 passes two correctly answered prerequisites even while both posteriors remain below theta", async () => {
    const session = new LessonSession(bundle(
      [quiz("q-a", "a"), quiz("q-b", "b"), concept("c-dep", "dep")],
      ["a", "b", "dep"], [prereq("dep", "a"), prereq("dep", "b")],
    ), buildTestDeps());
    await session.start();
    await session.respond({ kind: "quiz_choice", choiceId: "right" });
    const transition = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(transition.kind).toBe("next");
    expect(transition.kind === "next" ? transition.presentation.scene.id : null).toBe("c-dep");
  });

  it("W1 graph remediation prefers an unseen prerequisite item and then resumes the gated scene", async () => {
    const session = new LessonSession(bundle(
      [quiz("q-base-1", "base"), concept("c-dep", "dep"), quiz("q-base-2", "base")],
      ["base", "dep"], [prereq("dep", "base")],
    ), buildTestDeps());
    await session.start();
    const detour = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(detour.kind === "remediate" ? detour.presentation.scene.id : null).toBe("q-base-2");
    expect(detour.navigation?.returns_to).toBe("c-dep");
    const resumed = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(resumed.kind === "next" ? resumed.presentation.scene.id : null).toBe("c-dep");
  });

  it("W1 prerequisite-pass memory does not masquerade as mastery for pacing", async () => {
    const session = new LessonSession(bundle(
      [quiz("q-base", "base"), concept("c-base-1", "base"), concept("c-base-2", "base"), explainBack("explain", "base")],
      ["base"], [], [], true,
    ), buildTestDeps());
    await session.start();
    const first = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(first.kind === "next" ? first.presentation.scene.id : null).toBe("c-base-1");
    const second = await session.respond({ kind: "ack" });
    expect(second.kind === "next" ? second.presentation.scene.id : null).toBe("c-base-2");
    expect(second.navigation?.kind).toBe("advance");
  });

  it("W2 keeps the captured replay rule on remediate_alt", async () => {
    const rule = { id: "rule_2err_replay_concept", when: { consecutive_errors_same_concept: ">=1" }, action: { kind: "replay_current_scene", reason: "errors_threshold" }, modulator: "M1", explanation_short: "retry" };
    const session = new LessonSession(bundle(
      [quiz("q1", "c", ["h1", "h2"]), quiz("q2", "c", ["h1", "h2"]), quiz("q3", "d")],
      ["c", "d"], [], [rule],
    ), buildTestDeps());
    await session.start();
    const transition = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(transition.kind).toBe("remediate_alt");
    expect(transition.navigation).toMatchObject({ rule_id: "rule_2err_replay_concept", modulator: "M1", returns_to: "q3" });
    expect(transition.kind === "remediate_alt" ? transition.presentation.hints_available : undefined).toBe(1);
    const resumed = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(resumed.kind === "next" ? resumed.presentation.scene.id : null).toBe("q3");
  });

  it("W6 announces an unassessable prerequisite once, then advances plainly", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const session = new LessonSession(bundle(
      [
        concept("c-base", "base"),
        { id: "r-base", type: "reproduction", title: "r-base", objective_refs: ["base"], concept_refs: ["base"], estimated_seconds: 0, adaptation_hooks: [], body: "practice" },
        concept("d1", "dep"), intro("d2", "dep"), quiz("d3", "dep"),
      ],
      ["base", "dep"], [prereq("dep", "base")],
    ), buildTestDeps({ telemetry }));
    await session.start();
    await session.respond({ kind: "ack" });
    const first = await session.respond({ kind: "ack" });
    expect(first.navigation?.kind).toBe("gate_unassessable");
    const second = await session.respond({ kind: "ack" });
    const third = await session.respond({ kind: "ack" });
    expect(second.navigation).toMatchObject({ kind: "advance", rule_id: null });
    expect(third.navigation).toMatchObject({ kind: "advance", rule_id: null });
    const announcements = telemetry.events.filter((event) => event.type === "adaptation_applied" && event.rule_id === "graph_prereq_unassessable");
    expect(announcements).toHaveLength(1);
  });

  it("W9 stops skip-on-mastery at an explain_back judgment scene", async () => {
    const session = new LessonSession(
      bundle([intro("i", "c"), explainBack("explain", "c"), quiz("q", "c"), concept("concept", "c")], ["c"], [], [], true),
      buildTestDeps(), masteredState("c"),
    );
    await session.start();
    const transition = await session.respond({ kind: "ack" });
    expect(transition.kind === "next" ? transition.presentation.scene.id : null).toBe("explain");
  });

  it("W16 preserves the last adaptation after completion", async () => {
    const rule = { id: "retry", when: { consecutive_errors_same_concept: ">=1" }, action: { kind: "replay_current_scene", reason: "wrong" }, modulator: "M1", explanation_short: "retry" };
    const session = new LessonSession(bundle([quiz("q", "c", ["h"])], ["c"], [], [rule]), buildTestDeps());
    await session.start();
    const replay = await session.respond({ kind: "quiz_choice", choiceId: "wrong" });
    expect(replay.kind === "replay" ? replay.presentation.hints_available : undefined).toBe(1);
    const completed = await session.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(completed.kind).toBe("complete");
    expect(session.explainLast()).toMatchObject({ rule_id: "retry", modulator: "M1" });
  });

  it("W17 reports skipped scene ids, normalized mastery, and graph detours", async () => {
    const skipped = new LessonSession(
      bundle([intro("i", "c"), quiz("q", "c"), concept("concept", "c"), explainBack("explain", "c")], ["c"], [], [], true),
      buildTestDeps(), masteredState("c"),
    );
    await skipped.start();
    const transition = await skipped.respond({ kind: "ack" });
    expect(transition.navigation?.skipped_scene_ids).toEqual(["q", "concept"]);
    const complete = await skipped.respond({ kind: "explanation", text: "alpha" });
    expect(complete.kind === "complete" ? complete.summary.mastery.c : undefined).toBeCloseTo(0.9);
    expect(complete.kind === "complete" ? complete.summary.scenes_detoured : undefined).toEqual({});

    const detoured = new LessonSession(bundle(
      [quiz("q-base", "base"), quiz("q-dep", "dep")], ["base", "dep"], [prereq("dep", "base")],
    ), buildTestDeps());
    await detoured.start();
    await detoured.respond({ kind: "quiz_choice", choiceId: "wrong" });
    await detoured.respond({ kind: "quiz_choice", choiceId: "right" });
    const done = await detoured.respond({ kind: "quiz_choice", choiceId: "right" });
    expect(done.kind === "complete" ? done.summary.scenes_detoured : undefined).toEqual({ "q-base": 1 });
  });

  it("W8 records pre/post confidence and folds post as the declared value", async () => {
    const meta = { id: "m", type: "meta_checkpoint", title: "M", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], pre_question: "pre", post_question: "post", scale_labels: ["0", "1", "2", "3", "4"] };
    const session = new LessonSession(bundle([meta], ["c"]), buildTestDeps());
    await session.start();
    await session.respond({ kind: "confidence", pre: 4, post: 1 });
    const signal = session.getState().history.find((entry) => entry.signal.kind === "confidence_declared")?.signal as Record<string, unknown>;
    expect(signal).toMatchObject({ value: 1, pre: 4, post: 1, confidence_delta: -3 });
  });
});

describe("W10 offline feedback", () => {
  const rubric = { completeness: 1, evidence_quality: 1, tone: 1 };
  const cases: Array<{ name: string; scene: object; response: object; count: string }> = [
    { name: "spot_the_flaw", scene: { id: "s", type: "spot_the_flaw", title: "S", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], flawed_content: "bad", claims: [{ id: "f", text: "flaw", flaws_expected: ["alpha"] }], model_correction: "correction", rubric }, response: { kind: "flaw_report", text: "alpha" }, count: "1/1" },
    { name: "summary_audit", scene: { id: "s", type: "summary_audit", title: "S", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], source_content: "source", ai_summary: "bad", claims: [{ id: "f", text: "flaw", flaws_expected: ["alpha"] }], model_correction: "correction", rubric }, response: { kind: "summary_audit", text: "alpha" }, count: "1/1" },
    { name: "explain_back", scene: explainBack("s", "c"), response: { kind: "explanation", text: "alpha" }, count: "1/1" },
    { name: "comparison", scene: { id: "s", type: "comparison", title: "S", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], prompt: "p", artifact_a: "a", artifact_b: "b", key_points: [{ id: "k", text: "point", cues: ["alpha"] }], model_answer: "model", rubric }, response: { kind: "comparison", text: "alpha" }, count: "1/1" },
    { name: "prompt_practice", scene: promptPractice("s", "c"), response: { kind: "prompt_submission", text: "alpha" }, count: "1/1" },
    { name: "communication_sim", scene: { id: "s", type: "communication_sim", title: "S", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], scenario: "scenario", prompt: "p", key_points: [{ id: "k", text: "point", cues: ["alpha"] }], model_response: "model", rubric }, response: { kind: "communication", text: "alpha" }, count: "1/1" },
    { name: "ai_critique", scene: { id: "s", type: "ai_critique", title: "S", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], claims: [{ id: "f", text: "claim", flaws_expected: ["alpha"] }], rubric }, response: { kind: "critique", text: "alpha" }, count: "1/1" },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} returns count-bearing feedback`, async () => {
      const session = new LessonSession(bundle([testCase.scene], ["c"]), buildTestDeps());
      await session.start();
      const transition = await session.respond(testCase.response as never);
      expect(transition.verdict?.feedback).toContain(testCase.count);
    });
  }

  it("deck feedback carries the W5 detail counts", async () => {
    const scene = { id: "deck", type: "spot_the_flaw", title: "D", objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [], flawed_content: "bad", claims: [{ id: "f", text: "flaw", flaws_expected: ["alpha"] }], sound_claims: [{ id: "ok", text: "sound" }], verdict_deck: true, model_correction: "correction", rubric };
    const deck = verdictDeck(scene.claims, scene.sound_claims, scene.id);
    const response = { kind: "flaw_verdicts" as const, verdicts: deck.map((item) => ({ token: item.token, flagged: item.flawed })) };
    const session = new LessonSession(bundle([scene], ["c"]), buildTestDeps());
    await session.start();
    const transition = await session.respond(response);
    expect(transition.verdict?.detail).toEqual({ caught: 1, planted: 1, false_positives: 0, sound_total: 1 });
    expect(transition.verdict?.feedback).toContain("1/1");
  });
});
