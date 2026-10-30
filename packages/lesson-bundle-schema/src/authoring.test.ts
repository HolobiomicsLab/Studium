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
