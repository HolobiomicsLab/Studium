// packages/lesson-session/src/session.prereq-gate-termination.test.ts
//
// A LESSON MUST END. graphAwareNextIndex's own doc claimed the prerequisite gate converges
// ("mastery rises on replay -> converges"), but that holds only for a learner whose mastery
// actually rises. A learner who keeps failing the prereq's answer-graded scenes never crosses
// theta, the gate never opens, and remediation re-serves the SAME scene forever: driving the
// real atomistique-l1 bundle with correct-but-off-keyword free-text answers replayed
// s1b-audit-particules 199 times in 400 steps and never completed. The learner's only exit was
// to type the authored cue words.
//
// The budget bounds the detour: after MAX_PREREQ_DETOURS routed attempts at the same
// prerequisite the gate RELEASES — the lesson advances without mastery, and says so
// (graph_prereq_gate_released) so the teacher sees an unmastered pass rather than a learner
// who silently never finished.
import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import { InMemoryTelemetrySink } from "./adapters/in-memory";
import { MAX_PREREQ_DETOURS } from "./graph-nav";
import { MAX_SCENE_REPLAYS } from "./session";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, conceptRef: string) {
  return { id, type: "quiz", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

const LWG = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:base", node_kind: "concept", title: "Base", bloom_level: "understand" },
    { id: "concept:suite", node_kind: "concept", title: "Suite", bloom_level: "apply" },
  ],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:suite", target: "concept:base" }],
};

function bundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "base", title: "Base", description: "d", bloom_level_target: "understand" },
      { id: "suite", title: "Suite", description: "d", bloom_level_target: "apply" },
    ],
    scenes: [quiz("q-base", "base"), quiz("q-suite", "suite")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    learning_workflow_graph: LWG,
  } as unknown as LessonBundle;
}

describe("prerequisite gate — a learner who never masters the prereq still finishes", () => {
  it("terminates instead of looping when mastery never crosses theta", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());
    await s.start();
    let steps = 0;
    let done = false;
    for (; steps < 50; steps++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // always wrong
      if (t.kind === "complete") { done = true; break; }
    }
    expect(done, `never completed in ${steps} always-wrong answers (unbounded prereq loop)`).toBe(true);
  });

  it("releases the gate after MAX_PREREQ_DETOURS routed attempts, not before", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(bundle(), buildTestDeps({ telemetry }));
    await s.start();
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (t.kind === "complete") break;
      seen.push((t as { presentation: { scene: { id: string } } }).presentation.scene.id);
    }
    // the learner gets MAX_PREREQ_DETOURS routed attempts at the prereq before being let through
    const detours = seen.filter((id) => id === "q-base").length;
    expect(detours).toBe(MAX_PREREQ_DETOURS);
    expect(seen).toContain("q-suite"); // the gated concept is eventually reached
  });

  it("announces the release so an unmastered pass is visible, not silent", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(bundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (t.kind === "complete") break;
    }
    const released = telemetry.events.filter(
      (e) => e.type === "adaptation_applied" && (e as { rule_id: string }).rule_id === "graph_prereq_gate_released",
    );
    expect(released.length).toBeGreaterThan(0);
  });

  it("a learner who DOES master the prereq is never released early (no behaviour change)", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(bundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // always right
      if (t.kind === "complete") break;
    }
    const released = telemetry.events.filter(
      (e) => e.type === "adaptation_applied" && (e as { rule_id: string }).rule_id === "graph_prereq_gate_released",
    );
    expect(released).toEqual([]);
  });
});

// The SECOND unbounded loop on the same walk: `rule_2err_replay_concept` fires
// replay_current_scene on consecutive errors, and when the concept has no UNSEEN alternate item
// the honest fallback is to replay the same scene — which fires the same rule again, forever.
// Observed on atomistique-l1: s3c-compare-noeuds replayed to the step limit. A replay is a
// second chance; an unlimited replay is a dead end.
const REPLAY_RULE = {
  id: "rule_2err_replay_concept",
  when: { consecutive_errors_same_concept: ">=2" },
  action: { kind: "replay_current_scene", reason: "errors_threshold" },
  modulator: "M1",
  explanation_short: "Deux erreurs : on revoit.",
};

function replayBundle(): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L2", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "base", title: "Base", description: "d", bloom_level_target: "understand" },
      { id: "tail", title: "Tail", description: "d", bloom_level_target: "understand" },
    ],
    // Both of the concept's answer-graded scenes are seen by the time the rule fires, so there is
    // no UNSEEN alternate to route to and the fallback is a same-scene replay — the real shape:
    // on atomistique-l1 the concept's quiz + explain_back were already done when the comparison
    // started failing. The trailing scene means the lesson has somewhere left to go.
    scenes: [quiz("q-base", "base"), quiz("q-base2", "base"), quiz("q-tail", "tail")],
    rules: [REPLAY_RULE], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
  } as unknown as LessonBundle;
}

describe("scene replay — a learner who keeps failing one scene still finishes", () => {
  it("terminates instead of replaying the same scene forever", async () => {
    const s = new LessonSession(replayBundle(), buildTestDeps());
    await s.start();
    let done = false;
    let i = 0;
    for (; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // always wrong
      if (t.kind === "complete") { done = true; break; }
    }
    expect(done, `never completed in ${i} always-wrong answers (unbounded replay loop)`).toBe(true);
  });

  it("still replays up to MAX_SCENE_REPLAYS — the second chance is preserved", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(replayBundle(), buildTestDeps({ telemetry }));
    await s.start();
    let replays = 0;
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (t.kind === "replay") replays += 1;
      if (t.kind === "complete") break;
    }
    expect(replays).toBe(MAX_SCENE_REPLAYS);
  });

  it("announces the exhausted budget rather than moving on silently", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(replayBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (t.kind === "complete") break;
    }
    const exhausted = telemetry.events.filter(
      (e) => e.type === "adaptation_applied" && (e as { rule_id: string }).rule_id === "replay_budget_exhausted",
    );
    expect(exhausted.length).toBe(1);
  });

  it("a learner who answers correctly never spends the replay budget", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(replayBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // always right
      if (t.kind === "complete") break;
    }
    expect(telemetry.events.filter(
      (e) => e.type === "adaptation_applied" && (e as { rule_id: string }).rule_id === "replay_budget_exhausted",
    )).toEqual([]);
  });
});
