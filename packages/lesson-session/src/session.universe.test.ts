import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { defaultConceptState, defaultLearnerState } from "@studium/learner-state";

function quiz(id: string, c: string) {
  return { id, type: "quiz", title: id, objective_refs: [c], concept_refs: [c], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}
const LWG = { schema_version: "1.0", course_id: "c",
  nodes: [{ id: "concept:fourier", node_kind: "concept", title: "F", bloom_level: "understand" },
          { id: "concept:fft", node_kind: "concept", title: "FFT", bloom_level: "apply" }],
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:fft", target: "concept:fourier" }] };

function bundle(active: string): LessonBundle {
  return { schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "fourier", title: "F", description: "d", bloom_level_target: "understand" },
               { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" }],
    // Three fourier quizzes so the learner can clear the MIN_MASTERY_ATTEMPTS floor by plain advances
    // (same-concept, always-available) WITHOUT triggering prereq remediation/escalation — that lets the
    // theta divergence (baseline 0.8 vs remedial 0.6) be observed in isolation at the fft gate.
    scenes: [quiz("q-fourier", "fourier"), quiz("q-fourier-2", "fourier"), quiz("q-fourier-3", "fourier"), quiz("q-fft", "fft")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    learning_workflow_graph: LWG,
    universes: { variants: [
      { id: "baseline", description: "d", decisions: { prereq_strictness: "standard" } },
      { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient" } },
    ], active },
  } as unknown as LessonBundle;
}

describe("LessonSession — dynamic universe escalation (one-way, repeated remediation)", () => {
  // baseline active; LWG fft requires fourier; remedial variant present (prereq_strictness lenient).
  // scenes: [q-fourier, q-fft]. Start at q-fourier (idx 0). Each wrong answer on q-fourier:
  // navigate candidate=q-fft (concept:fft) locked (fourier mastery low) -> remediate to q-fourier.
  // After ESCALATE_AFTER=2 remediations, escalate baseline->remedial.
  function escBundle(): LessonBundle {
    return {
      schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
      metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
      concepts: [
        { id: "fourier", title: "F", description: "d", bloom_level_target: "understand" },
        { id: "fft", title: "FFT", description: "d", bloom_level_target: "apply" },
      ],
      scenes: [quiz("q-fourier", "fourier"), quiz("q-fft", "fft")],
      rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
      learning_workflow_graph: LWG,
      universes: { variants: [
        { id: "baseline", description: "d", decisions: { prereq_strictness: "standard", pacing: "standard" } },
        { id: "remedial", description: "d", decisions: { prereq_strictness: "lenient", pacing: "standard" } },
      ], active: "baseline" },
    } as unknown as LessonBundle;
  }

  it("escalates baseline->remedial after ESCALATE_AFTER remediations, re-emitting universe_selected", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(escBundle(), deps);
    await s.start();                                    // q-fourier (idx0)
    // Each WRONG answer on q-fourier: navigate candidate=q-fft (fft) locked (fourier low) -> remediate to q-fourier.
    // 2 such remediations -> escalate to remedial.
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // remediation #1
    await s.respond({ kind: "quiz_choice", choiceId: "a" }); // remediation #2 -> escalate
    const sink = deps.telemetry as import("./testing").InMemoryTelemetrySink;
    const universeEvents = sink.events.filter((e) => e.type === "universe_selected");
    expect(universeEvents.map((e: any) => e.universe_id)).toEqual(["baseline", "remedial"]); // start + escalation
    const esc = sink.events.find((e: any) => e.type === "adaptation_applied" && e.rule_id === "graph_universe_escalated");
    expect(esc).toBeDefined();
    expect(s.explainLast()?.rule_id).toBe("graph_universe_escalated");
  });

  it("does not escalate without a remedial variant (one-way + guarded)", async () => {
    const deps = buildTestDeps();
    const b = escBundle();
    (b as any).universes.variants = (b as any).universes.variants.filter((v: any) => v.id === "baseline");
    const s = new LessonSession(b, deps);
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "a" });
    await s.respond({ kind: "quiz_choice", choiceId: "a" });
    const sink = deps.telemetry as import("./testing").InMemoryTelemetrySink;
    expect(sink.events.filter((e) => e.type === "universe_selected").length).toBe(1); // only the start emit
  });
});

describe("LessonSession — universe-driven theta", () => {
  it("emits universe_selected with the active variant's decisions", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle("remedial"), deps);
    await s.start();
    const sink: any = deps.telemetry;
    const ev = (sink.events ?? []).find((e: any) => e.type === "universe_selected");
    expect(ev?.universe_id).toBe("remedial");
    expect(ev?.active_decisions?.prereq_strictness).toBe("lenient");
  });

  it("remedial universe (theta 0.6) unlocks the dependent earlier than baseline (theta 0.8)", async () => {
    // Start at mastery 0.9 with three prior attempts, then submit one wrong answer on this true/false
    // item: beta 1 + 1.5 = 2.5, and the correction for guessing (RT-2, beta-updater) moves the expected
    // lucky credit 1.5 · g/(1-g) = 1.5 from alpha to beta: alpha 7.5, beta 4 -> mastery≈0.652, between
    // the two thetas. (Before RT-2 this test seeded alpha 4 and reached 0.615 without the transfer.)
    // No correct answer occurs in this session, so W1's session-local prerequisite-pass memory does
    // not supersede the theta comparison this test isolates.
    const initial = defaultLearnerState("L1");
    initial.concept_states.fourier = {
      ...defaultConceptState("fourier"), alpha: 9, beta: 1, total_attempts: 3, total_correct: 2,
    };
    const twoSceneBundle = (active: string) => {
      const value = bundle(active);
      value.scenes = [quiz("q-fourier", "fourier"), quiz("q-fft", "fft")] as unknown as LessonBundle["scenes"];
      return value;
    };
    const sB = new LessonSession(twoSceneBundle("baseline"), buildTestDeps(), initial);
    await sB.start();
    const tB = await sB.respond({ kind: "quiz_choice", choiceId: "a" });
    expect((tB as any).presentation.scene.id).toBe("q-fourier"); // baseline: fft locked -> remediate to fourier

    const sR = new LessonSession(twoSceneBundle("remedial"), buildTestDeps(), initial);
    await sR.start();
    const tR = await sR.respond({ kind: "quiz_choice", choiceId: "a" });
    expect((tR as any).presentation.scene.id).toBe("q-fft");      // remedial: 0.652 >= 0.6 -> fft unlocked
  });
});
