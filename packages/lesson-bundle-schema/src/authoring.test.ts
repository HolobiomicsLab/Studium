import { describe, expect, it } from "vitest";
import { BundleAuthoringSchema, BundleMetadataSchema } from "./index";

const base = { title: "T", target: "L1", duration_minutes: 30, language: "fr", discipline: "chimie" };

describe("BundleMetadata.authoring", () => {
  it("is optional: a pre-2026-10-30 bundle still parses and carries no authoring", () => {
    const parsed = BundleMetadataSchema.parse(base);
    expect(parsed.authoring).toBeUndefined();
  });

  it("accepts a self-study block and defaults author_is_learner to false", () => {
    const parsed = BundleMetadataSchema.parse({ ...base, authoring: { mode: "self_study" } });
    expect(parsed.authoring).toEqual({ mode: "self_study", author_is_learner: false });
  });

  it("keeps author_is_learner and note when given", () => {
    const parsed = BundleAuthoringSchema.parse({ mode: "self_study", author_is_learner: true, note: "Durkheim ch. 1" });
    expect(parsed).toEqual({ mode: "self_study", author_is_learner: true, note: "Durkheim ch. 1" });
  });

  it("rejects an unknown mode", () => {
    expect(() => BundleAuthoringSchema.parse({ mode: "peer" })).toThrow();
  });
});

// C3 (sprint 2026-10-30): who drafted the content and its keys, separate from who plays it.
describe("BundleAuthoring.drafted_by", () => {
  it.each(["agent", "learner", "teacher"] as const)("accepts drafted_by %s and keeps it", (draftedBy) => {
    const parsed = BundleAuthoringSchema.parse({ mode: "self_study", drafted_by: draftedBy });
    expect(parsed.drafted_by).toBe(draftedBy);
  });

  it("is optional: a block without it parses unchanged", () => {
    expect(BundleAuthoringSchema.parse({ mode: "teacher" })).toEqual({ mode: "teacher", author_is_learner: false });
  });

  it("rejects any other value", () => {
    expect(BundleAuthoringSchema.safeParse({ mode: "self_study", drafted_by: "model" }).success).toBe(false);
  });
});
