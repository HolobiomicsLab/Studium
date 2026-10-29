import { describe, expect, it } from "vitest";
import { ResponseInputSchema } from "./response-input-schema.js";

describe("ResponseInputSchema confidence checkpoints", () => {
  it("accepts both legacy value and explicit pre/post confidence", () => {
    expect(ResponseInputSchema.parse({ kind: "confidence", value: 3 })).toEqual({ kind: "confidence", value: 3 });
    expect(ResponseInputSchema.parse({ kind: "confidence", pre: 4, post: 1 })).toEqual({
      kind: "confidence",
      pre: 4,
      post: 1,
    });
  });

  it("requires a complete confidence shape", () => {
    expect(ResponseInputSchema.safeParse({ kind: "confidence", pre: 4 }).success).toBe(false);
  });
});
