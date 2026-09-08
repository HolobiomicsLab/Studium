// Cross-lesson FSRS MEMORY persistence on the learner profile. The per-bundle session derives FSRS
// memory by replaying answer history (it's not stored in LearnerState); this carries that memory
// ACROSS lessons so spaced-repetition routing can see a concept reviewed in lesson A while the learner
// is in lesson B. mergeConceptMemoryIntoProfile is the carry-forward (latest-wins per concept).
import { describe, it, expect } from "vitest";
import {
  defaultLearnerProfile,
  ConceptMemoryStateSchema,
  mergeConceptMemoryIntoProfile,
  type ConceptMemoryState,
  type LearnerProfile,
} from "./index.js";

const mem = (cid: string, over: Partial<ConceptMemoryState> = {}): ConceptMemoryState => ({
  concept_id: cid, stability: 5, difficulty: 5, last_reviewed_at: 1000, reps: 1, lapses: 0, ...over,
});

describe("ConceptMemoryStateSchema", () => {
  it("accepts a well-formed memory state and a null last_reviewed (unseen)", () => {
    expect(ConceptMemoryStateSchema.safeParse(mem("c")).success).toBe(true);
    expect(ConceptMemoryStateSchema.safeParse(mem("c", { last_reviewed_at: null, reps: 0 })).success).toBe(true);
  });
  it("rejects negative reps / lapses", () => {
    expect(ConceptMemoryStateSchema.safeParse(mem("c", { reps: -1 })).success).toBe(false);
    expect(ConceptMemoryStateSchema.safeParse(mem("c", { lapses: -2 })).success).toBe(false);
  });
});

describe("mergeConceptMemoryIntoProfile — cross-lesson FSRS memory carry-forward", () => {
  it("folds a session's memory map into an empty profile + stamps updated_at; non-mutating", () => {
    const profile = defaultLearnerProfile("p", "t0");
    const merged = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin", { stability: 7 }) }, "t1");
    expect(merged.concept_memory?.["c-kin"]?.stability).toBe(7);
    expect(merged.updated_at).toBe("t1");
    expect(profile.concept_memory).toBeUndefined(); // input untouched
  });

  it("latest-wins per concept (a fresh review of c-kin replaces the older memory; other concepts kept)", () => {
    let profile: LearnerProfile = defaultLearnerProfile("p", "t0");
    profile = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin", { stability: 3, reps: 1 }), "c-units": mem("c-units") }, "t1");
    const merged = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin", { stability: 9, reps: 2 }) }, "t2");
    expect(merged.concept_memory?.["c-kin"]?.stability).toBe(9); // newer wins
    expect(merged.concept_memory?.["c-kin"]?.reps).toBe(2);
    expect(merged.concept_memory?.["c-units"]?.stability).toBe(5); // untouched concept preserved
    expect(merged.updated_at).toBe("t2");
  });

  it("an empty memory map leaves the profile's concept_memory unchanged (still stamps time)", () => {
    let profile = defaultLearnerProfile("p", "t0");
    profile = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin") }, "t1");
    const merged = mergeConceptMemoryIntoProfile(profile, {}, "t2");
    expect(merged.concept_memory?.["c-kin"]?.stability).toBe(5);
    expect(merged.updated_at).toBe("t2");
  });

  it("an UNSEEN (reps:0) incoming entry must NOT clobber a real cross-lesson memory", () => {
    // c-kin reviewed in lesson A (reps 1, real memory)…
    let profile = defaultLearnerProfile("p", "t0");
    profile = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin", { reps: 1, stability: 8, last_reviewed_at: 1000 }) }, "t1");
    // …then lesson B DECLARES c-kin (warm-seeded) but the learner never answers it → replays to reps:0.
    const merged = mergeConceptMemoryIntoProfile(profile, { "c-kin": mem("c-kin", { reps: 0, stability: 0, last_reviewed_at: null }) }, "t2");
    expect(merged.concept_memory?.["c-kin"]?.reps).toBe(1);       // preserved — NOT regressed to the default
    expect(merged.concept_memory?.["c-kin"]?.stability).toBe(8);
    expect(merged.updated_at).toBe("t2");
  });
});
