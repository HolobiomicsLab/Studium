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

// HJ-7: a 13-branch union answered a missing field with "Invalid input" (MCP SDK 1.32) or a 13 KB
// dump (older SDKs). One object with a kind enum names the missing field in one line.
describe("ResponseInputSchema — one object, one-line errors", () => {
  it("names the missing field of a kind in a single issue", () => {
    // Pinned on flaw_verdicts since lead decision I-4: a quiz_choice without choiceId now reaches the
    // host, which refuses it naming the displayed ids (the schema has no session to list them from).
    const result = ResponseInputSchema.safeParse({ kind: "flaw_verdicts" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]!.message).toMatch(/^flaw_verdicts needs verdicts/);
    expect(result.error.issues[0]!.path).toEqual(["verdicts"]);
  });

  it("passes a quiz_choice without choiceId to the host, which refuses it with the displayed ids (I-4)", () => {
    expect(ResponseInputSchema.parse({ kind: "quiz_choice" })).toEqual({ kind: "quiz_choice" });
    expect(ResponseInputSchema.parse({ kind: "quiz_choice", confidence: 2 })).toEqual({ kind: "quiz_choice", confidence: 2 });
  });

  it("says which kinds exist when the kind is unknown", () => {
    const result = ResponseInputSchema.safeParse({ kind: "answer", text: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]!.message).toMatch(/quiz_choice/);
    expect(result.error.issues[0]!.message).toMatch(/reply/);
  });

  it("free-text kinds need text; a verdict deck needs verdicts", () => {
    expect(ResponseInputSchema.safeParse({ kind: "explanation" }).success).toBe(false);
    expect(ResponseInputSchema.safeParse({ kind: "flaw_verdicts" }).success).toBe(false);
    expect(ResponseInputSchema.parse({ kind: "explanation", text: "", confidence: 2 }))
      .toEqual({ kind: "explanation", text: "", confidence: 2 });
  });

  it("accepts {kind:'reply', text}, which the host maps to the current scene's input", () => {
    expect(ResponseInputSchema.parse({ kind: "reply", text: "b" })).toEqual({ kind: "reply", text: "b" });
    expect(ResponseInputSchema.safeParse({ kind: "reply" }).success).toBe(false);
  });

  it("keeps only the fields a kind takes, as the union did", () => {
    expect(ResponseInputSchema.parse({ kind: "ack", text: "ignored" })).toEqual({ kind: "ack" });
    expect(ResponseInputSchema.parse({ kind: "quiz_choice", choiceId: "a", text: "x" })).toEqual({ kind: "quiz_choice", choiceId: "a" });
    expect(ResponseInputSchema.parse({ kind: "confidence", value: 2, pre: 1 })).toEqual({ kind: "confidence", value: 2 });
  });
});

// D4 (pass of 10 Nov 2026): a confidence relayed with reply is kept, and checked as for typed inputs.
describe("ResponseInputSchema — reply carries a confidence", () => {
  it("keeps a valid confidence 0 to 4 with reply", () => {
    expect(ResponseInputSchema.parse({ kind: "reply", text: "b", confidence: 4 })).toEqual({ kind: "reply", text: "b", confidence: 4 });
    expect(ResponseInputSchema.parse({ kind: "reply", text: "b", confidence: 0 })).toEqual({ kind: "reply", text: "b", confidence: 0 });
  });

  it("refuses an out-of-range or non-integer confidence with reply, as with typed inputs", () => {
    for (const confidence of [5, -1, 2.5]) {
      const result = ResponseInputSchema.safeParse({ kind: "reply", text: "b", confidence });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]!.message).toMatch(/a confidence is an integer from 0 to 4/);
    }
  });
});
