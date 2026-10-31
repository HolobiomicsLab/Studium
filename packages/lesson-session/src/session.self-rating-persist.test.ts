// Sprint verification fix wave (2026-10-30, lead decision L-9).
//
// RFR-10: a self-rating on a scene covering several concepts scheduled only concept_refs[0]; the
// record now names every concept of the rated scene (`concept_ids`), `concept_id` staying the first.
// CC-8: the pending request lived only in memory, so a server restart between the answer and the
// rating made the resumed session say "no self-rating was requested" — false. Requests are now saved
// with the per-bundle LearnerState and restored by the next session; a request a state no longer holds
// (saved by a server that kept requests in memory only) is refused with a distinct error.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LearnerStateSchema, type LearnerState } from "@studium/learner-state";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryStateStore } from "./testing.js";
import { StubCritiqueEvaluator } from "./adapters/critique-evaluator.js";
import { SelfRatingExpiredError, SelfRatingNotRequestedError } from "./errors.js";

const rubric = { completeness: 1, evidence_quality: 1, tone: 1 };
const explainBack = (id: string, concepts: string[]) => ({
  id, type: "explain_back", title: id, objective_refs: ["c1"], concept_refs: concepts, estimated_seconds: 0, adaptation_hooks: [],
  prompt: "Explique.", key_points: [{ id: "kp", text: "Le point", cues: ["point"] }], model_explanation: "Le modèle.", rubric,
});
const concept = (id: string) => ({ id, title: id, description: "d", bloom_level_target: "understand" });

const BUNDLE = {
  schema_version: "1.4", bundle_id: "persist", source_plan_id: "p",
  metadata: { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [concept("c1"), concept("c2"), concept("c3")],
  scenes: [explainBack("synth", ["c1", "c2", "c3"]), explainBack("next", ["c2"])],
  rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
} as unknown as LessonBundle;

const deps = (stateStore = new InMemoryStateStore()) => buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), stateStore });

async function answeredSynthesis(stateStore = new InMemoryStateStore()) {
  const session = new LessonSession(BUNDLE, deps(stateStore));
  await session.start();
  const t = await session.respond({ kind: "explanation", text: "le point" });
  expect(t.self_rating?.requested).toBe(true);
  return { session, stateStore };
}

describe("L-9 — a self-rating rates every concept of its scene", () => {
  it("the record names each concept_ref; concept_id stays the first", async () => {
    const { session } = await answeredSynthesis();
    const record = await session.rateRecall("synth", "good");
    expect(record.concept_ids).toEqual(["c1", "c2", "c3"]);
    expect(record.concept_id).toBe("c1");
  });
});

describe("L-9 — a pending self-rating survives a server restart", () => {
  it("the request is saved with the learner state, and the state still parses", async () => {
    const { stateStore } = await answeredSynthesis();
    const saved = await stateStore.load("persist");
    const parsed = LearnerStateSchema.parse(saved);
    expect(parsed.self_rating_requests?.["synth"]).toMatchObject({ concept_ids: ["c1", "c2", "c3"] });
  });

  it("a new session on the saved state accepts the rating, once", async () => {
    const { stateStore } = await answeredSynthesis();
    const prior = LearnerStateSchema.parse(await stateStore.load("persist"));
    const resumed = new LessonSession(BUNDLE, deps(stateStore), prior);
    await resumed.start();
    const record = await resumed.rateRecall("synth", "hard");
    expect(record).toMatchObject({ scene_id: "synth", concept_ids: ["c1", "c2", "c3"], grade: "hard" });
    // The rating clears the request, in memory and in the saved state.
    await expect(resumed.rateRecall("synth", "good")).rejects.toBeInstanceOf(SelfRatingNotRequestedError);
    const after = LearnerStateSchema.parse(await stateStore.load("persist"));
    expect(after.self_rating_requests?.["synth"]).toBeUndefined();
  });

  it("a request the saved state lost gives a distinct error, not 'none was requested'", async () => {
    const { stateStore } = await answeredSynthesis();
    // What a server that kept requests in memory only left behind: the answer, no request.
    const { self_rating_requests: _dropped, ...legacy } = (await stateStore.load("persist")) as LearnerState;
    const resumed = new LessonSession(BUNDLE, deps(stateStore), legacy as LearnerState);
    await resumed.start();
    const error = await resumed.rateRecall("synth", "good").then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(SelfRatingExpiredError);
    expect(error).not.toBeInstanceOf(SelfRatingNotRequestedError);
    expect((error as Error).message).toMatch(/expired/);
  });

  it("a scene never answered is still 'not requested'", async () => {
    const session = new LessonSession(BUNDLE, deps());
    await session.start();
    await expect(session.rateRecall("next", "good")).rejects.toBeInstanceOf(SelfRatingNotRequestedError);
  });
});
