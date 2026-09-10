// packages/lesson-session/src/session.prereq-unassessable.test.ts
//
// INT-STUDIUM-037 — THE GATE THAT OPENED WITHOUT SAYING SO.
//
// INT-STUDIUM-036 bounded the prerequisite detour and made the release audible: past
// MAX_PREREQ_DETOURS the learner is let into the gated scene and `graph_prereq_gate_released`
// tells the teacher an unmastered pass happened. That covers the case where remediation was
// TRIED and did not take.
//
// There is a second way into the same gated scene, and it was silent. When the unmet prerequisite
// has no scene the router can route back to, `firstAnswerGradedSceneForConcept` returns -1 and the
// old code fell through to `reason: "advance"` — the reason an ordinary next-scene step carries.
// No detour is spent, so the budget never runs out, so the release never fires. The learner walks
// through the gate on the first try and nothing anywhere records it.
//
// It is not hypothetical. On the real atomistique-l1 bundle, a learner who has mastered nothing
// enters a gated scene this way FOUR times and `graph_prereq_gate_released` fires ZERO times:
// `concept:c-configuration` is a prerequisite of both `c-periodicite` and `c-geometrie`, and its
// only assessing scene is a `prompt_practice` — which emits an `answer_submitted` but is not one of
// the two types this router will route to. `fixtures/atomistique-l1/prereq_routing_check.mjs`
// re-runs that measurement.
//
// The fix here is a REPORT, not a route: the learner's path is byte-identical (asserted below),
// and what changes is that the session now says `graph_prereq_unassessable`. It gets its own
// rule_id because the two facts differ in who can act on them — a release says the learner did not
// manage it after three tries, this says the bundle offered nothing to try, which is an authoring
// defect the teacher can fix.
import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps } from "./testing";
import { InMemoryTelemetrySink } from "./adapters/in-memory";
import { graphAwareNextIndex, MAX_PREREQ_DETOURS } from "./graph-nav";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string, conceptRef: string) {
  return { id, type: "quiz", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}

// The shape the real bundle has for `c-configuration`: a concept assessed ONLY by a free-text
// scene type the router does not list. It emits an answer_submitted like any other; it is simply
// invisible to remediation routing.
function promptPractice(id: string, conceptRef: string) {
  return { id, type: "prompt_practice", title: id, objective_refs: [conceptRef], concept_refs: [conceptRef],
    estimated_seconds: 0, adaptation_hooks: [],
    task: "rédige une consigne", key_points: [{ id: "k1", text: "niveau", cues: ["l1"] }],
    model_prompt: "modèle", rubric: { completeness: 0.5, evidence_quality: 0.5, tone: 0.5 } };
}

const LWG = {
  schema_version: "1.0", course_id: "c",
  nodes: [
    { id: "concept:base", node_kind: "concept", title: "Base", bloom_level: "understand" },
    { id: "concept:suite", node_kind: "concept", title: "Suite", bloom_level: "apply" },
  ],
  // source = the dependent concept, target = its prerequisite (graph-router's convention).
  edges: [{ id: "e1", relation: "prerequisite_for", source: "concept:suite", target: "concept:base" }],
};

function bundleWith(baseScene: object): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [
      { id: "base", title: "Base", description: "d", bloom_level_target: "understand" },
      { id: "suite", title: "Suite", description: "d", bloom_level_target: "apply" },
    ],
    scenes: [baseScene, quiz("q-suite", "suite")],
    rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z",
    learning_workflow_graph: LWG,
  } as unknown as LessonBundle;
}

/** The prerequisite's only scene is one the router will not route to. */
const unassessableBundle = () => bundleWith(promptPractice("p-base", "base"));
/** Control: the same graph, but the prerequisite HAS a quiz — the INT-STUDIUM-036 path. */
const assessableBundle = () => bundleWith(quiz("q-base", "base"));

function rulesFired(t: InMemoryTelemetrySink, ruleId: string) {
  return t.events.filter((e) => e.type === "adaptation_applied" && (e as { rule_id: string }).rule_id === ruleId);
}

describe("prerequisite gate — opening it because nothing can assess the prerequisite", () => {
  it("announces graph_prereq_unassessable instead of passing silently", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(unassessableBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 20; i++) {
      const t = await s.respond({ kind: "prompt_submission", text: "explique" });
      if (t.kind === "complete") break;
      // the gated scene is a quiz from here on
      const q = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (q.kind === "complete") break;
    }
    expect(rulesFired(telemetry, "graph_prereq_unassessable").length).toBeGreaterThan(0);
  });

  it("does NOT borrow the release's rule_id — no detour was spent, so nothing was released", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(unassessableBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 20; i++) {
      const t = await s.respond({ kind: "prompt_submission", text: "explique" });
      if (t.kind === "complete") break;
      const q = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (q.kind === "complete") break;
    }
    expect(rulesFired(telemetry, "graph_prereq_gate_released")).toEqual([]);
    expect(rulesFired(telemetry, "graph_prereq_gate")).toEqual([]); // never routed anywhere either
  });

  it("the lesson still ends — the gate opens, it does not stall", async () => {
    const s = new LessonSession(unassessableBundle(), buildTestDeps());
    await s.start();
    let done = false;
    for (let i = 0; i < 20 && !done; i++) {
      const t = await s.respond({ kind: "prompt_submission", text: "explique" });
      if (t.kind === "complete") { done = true; break; }
      const q = await s.respond({ kind: "quiz_choice", choiceId: "a" });
      if (q.kind === "complete") done = true;
    }
    expect(done).toBe(true);
  });

  it("the OTHER path is untouched: a routable prerequisite still remediates, then releases", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(assessableBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "a" }); // always wrong
      if (t.kind === "complete") break;
    }
    expect(rulesFired(telemetry, "graph_prereq_gate_released").length).toBeGreaterThan(0);
    expect(rulesFired(telemetry, "graph_prereq_unassessable")).toEqual([]);
  });

  it("a learner who masters the prerequisite meets neither announcement", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const s = new LessonSession(assessableBundle(), buildTestDeps({ telemetry }));
    await s.start();
    for (let i = 0; i < 50; i++) {
      const t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // always right
      if (t.kind === "complete") break;
    }
    expect(rulesFired(telemetry, "graph_prereq_unassessable")).toEqual([]);
    expect(rulesFired(telemetry, "graph_prereq_gate_released")).toEqual([]);
  });
});

// The point of the change is that it is a REPORT. If the index moved too, this would be a routing
// decision — and which scene types remediation should target is exactly the question
// INT-STUDIUM-037 files and leaves to the owner.
describe("graphAwareNextIndex — the learner's path does not move", () => {
  const scenes = [
    { id: "p-base", type: "prompt_practice", concept_refs: ["base"] },
    { id: "q-suite", type: "quiz", concept_refs: ["suite"] },
  ];

  it("returns the SAME index it returned before, with a truthful reason", () => {
    const r = graphAwareNextIndex(scenes, 0, LWG as never, {}, 0.8, false, {}, {});
    expect(r.index).toBe(1); // the gated scene — unchanged, this is where the old code went too
    expect(r.reason).toBe("gate_unassessable"); // it used to say "advance"
  });

  it("still reports gate_released when a remedial scene EXISTS and the budget is spent", () => {
    const routable = [
      { id: "q-base", type: "quiz", concept_refs: ["base"] },
      { id: "q-suite", type: "quiz", concept_refs: ["suite"] },
    ];
    const spent = graphAwareNextIndex(routable, 0, LWG as never, {}, 0.8, false, {}, {
      "concept:base": MAX_PREREQ_DETOURS,
    });
    expect(spent).toEqual({ index: 1, reason: "gate_released" });
    const fresh = graphAwareNextIndex(routable, 0, LWG as never, {}, 0.8, false, {}, {});
    expect(fresh).toEqual({ index: 0, reason: "remediate" });
  });

  it("an AVAILABLE concept is still a plain advance — the new reason is not overreaching", () => {
    const r = graphAwareNextIndex(scenes, 0, LWG as never, { "concept:base": 1 }, 0.8, false, {}, {});
    expect(r).toEqual({ index: 1, reason: "advance" });
  });
});
