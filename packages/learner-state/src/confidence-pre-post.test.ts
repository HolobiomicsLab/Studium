// A paired meta_checkpoint (pre_question / post_question) records both declarations. They must
// survive the durable round trip: FileStateStore parses the JSON through LearnerStateSchema, and a
// zod object strips any key the schema does not declare.
import { describe, it, expect } from "vitest";
import { LearnerStateSchema, SignalSchema, defaultLearnerState } from "./index.js";

describe("confidence_declared pre/post (durable)", () => {
  it("keeps pre, post and confidence_delta through a schema parse", () => {
    const state = defaultLearnerState("L");
    state.history.push({
      timestamp: "2026-10-29T10:00:00.000Z",
      scene_id: "m",
      decision: { next_action: { kind: "advance_to_next_scene" }, rule_id: null, explanation_short: null, modulator: null },
      signal: { kind: "confidence_declared", scene_id: "m", value: 1, concept_id: "c", pre: 4, post: 1, confidence_delta: -3 },
    });
    const parsed = LearnerStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(parsed.history[0]?.signal).toMatchObject({ kind: "confidence_declared", value: 1, pre: 4, post: 1, confidence_delta: -3 });
  });

  it("still accepts a single-question declaration without the paired fields", () => {
    const s = SignalSchema.parse({ kind: "confidence_declared", scene_id: "m", value: 2, concept_id: "c" });
    expect("pre" in s).toBe(false);
  });

  it("rejects a delta outside -4..4", () => {
    expect(() => SignalSchema.parse({ kind: "confidence_declared", scene_id: "m", value: 2, pre: 0, post: 2, confidence_delta: 9 })).toThrow();
  });
});
