// apps/lesson-server/src/envelope.test.ts
import { describe, it, expect } from "vitest";
import { ok, err } from "./envelope.js";

describe("envelope", () => {
  it("ok wraps data with success+ok true", () => {
    expect(ok({ session_id: "s1" })).toEqual({ success: true, ok: true, session_id: "s1" });
  });
  it("err carries the message with both flags false", () => {
    expect(err("nope")).toEqual({ success: false, ok: false, error: "nope" });
  });
});
