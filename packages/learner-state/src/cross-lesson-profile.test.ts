import { describe, it, expect } from "vitest";
import {
  defaultLearnerState, defaultLearnerProfile, defaultConceptState,
  seedConceptStatesFromProfile, mergeConceptStatesIntoProfile, masteryOf,
  type LearnerProfile,
} from "./index.js";

const mastered = (cid: string) => ({ ...defaultConceptState(cid), alpha: 9, beta: 1, total_attempts: 5, total_correct: 5 });
const profileWith = (cs: Record<string, ReturnType<typeof mastered>>): LearnerProfile =>
  ({ pseudonym: "p", schema_version: "1.0", updated_at: "t", concept_states: cs });

describe("cross-lesson profile — seed (warm start) + merge (carry forward)", () => {
  it("seeds a bundle concept from the profile but NOT one the bundle doesn't use", () => {
    const profile = profileWith({ "c-kin": mastered("c-kin"), "c-other": mastered("c-other") });
    const seeded = seedConceptStatesFromProfile(defaultLearnerState("B"), profile, ["c-kin"]); // B uses only c-kin
    expect(masteryOf(seeded.concept_states["c-kin"]!)).toBeGreaterThan(0.8); // warm
    expect(seeded.concept_states["c-other"]).toBeUndefined();               // not used by this bundle
  });

  it("does NOT overwrite a concept already worked in THIS bundle (per-bundle precedence)", () => {
    const profile = profileWith({ "c-kin": mastered("c-kin") });
    const state = { ...defaultLearnerState("B"), concept_states: { "c-kin": defaultConceptState("c-kin") } }; // cold, present
    const seeded = seedConceptStatesFromProfile(state, profile, ["c-kin"]);
    expect(masteryOf(seeded.concept_states["c-kin"]!)).toBe(0.5); // untouched — per-bundle state wins
  });

  it("merges the session's concept_states into the profile (latest-wins) + stamps updated_at; non-mutating", () => {
    const profile = defaultLearnerProfile("p", "t0");
    const state = { ...defaultLearnerState("A"), concept_states: { "c-kin": mastered("c-kin") } };
    const merged = mergeConceptStatesIntoProfile(profile, state, "t1");
    expect(masteryOf(merged.concept_states["c-kin"]!)).toBeGreaterThan(0.8);
    expect(merged.updated_at).toBe("t1");
    expect(profile.concept_states["c-kin"]).toBeUndefined(); // input profile untouched
  });

  it("round-trips: master in A -> merge to profile -> seed B WARM", () => {
    let profile = defaultLearnerProfile("p", "t0");
    profile = mergeConceptStatesIntoProfile(profile, { ...defaultLearnerState("A"), concept_states: { "c-kin": mastered("c-kin") } }, "t1");
    const b = seedConceptStatesFromProfile(defaultLearnerState("B"), profile, ["c-kin"]);
    expect(masteryOf(b.concept_states["c-kin"]!)).toBeGreaterThan(0.8);
  });
});
