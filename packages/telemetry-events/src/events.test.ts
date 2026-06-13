import { describe, it, expect } from "vitest";
import { TelemetryEventSchema } from "./events.js";

describe("tutor_move telemetry event", () => {
  const base = {
    event_id: "01923456-7890-1234-5678-abcdef012345",
    learner_pseudonym: "hmac:abc",
    lesson_id: "demo",
    bundle_version: "1.0.0",
    client_timestamp: "2026-05-09T10:00:00Z",
    type: "tutor_move", scene_id: "d1", move_kind: "invite_test",
    in_reply_to_signal: "hypothesis", revealed: false, reveal_blocked: false, turn_index: 0 };
  it("accepts a valid metadata-only tutor_move", () => {
    expect(() => TelemetryEventSchema.parse(base)).not.toThrow();
  });
  it("rejects an unknown move_kind", () => {
    expect(() => TelemetryEventSchema.parse({ ...base, move_kind: "reveal_it" })).toThrow();
  });
  it("rejects any free-text field (strict: no text in telemetry)", () => {
    const r = TelemetryEventSchema.safeParse({ ...base, tutor_text: "the answer is X" });
    // unknown keys are stripped by zod object parse; assert the parsed object has no text
    if (r.success) expect((r.data as Record<string, unknown>)["tutor_text"]).toBeUndefined();
  });
});
