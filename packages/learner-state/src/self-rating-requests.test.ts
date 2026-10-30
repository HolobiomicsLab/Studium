// L-9 (2026-10-30): pending self-rating requests are saved with the per-bundle LearnerState.
import { describe, expect, it } from "vitest";
import { LearnerStateSchema, defaultLearnerState } from "./index.js";

describe("LearnerState.self_rating_requests", () => {
  it("round-trips a pending request", () => {
    const state = { ...defaultLearnerState("b"), self_rating_requests: { s1: { concept_ids: ["c1", "c2"], requested_at: "2026-10-30T10:00:00.000Z" } } };
    expect(LearnerStateSchema.parse(state).self_rating_requests).toEqual(state.self_rating_requests);
  });
  it("a state saved before the field existed still parses, without it", () => {
    const parsed = LearnerStateSchema.parse(defaultLearnerState("b"));
    expect(parsed).not.toHaveProperty("self_rating_requests");
  });
  it("a request naming no concept is refused", () => {
    const state = { ...defaultLearnerState("b"), self_rating_requests: { s1: { concept_ids: [], requested_at: "x" } } };
    expect(LearnerStateSchema.safeParse(state).success).toBe(false);
  });
});
