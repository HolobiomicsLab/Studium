import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LessonBundleSchema } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import type { ResponseInput } from "./types.js";

const bundle = LessonBundleSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/all-scene-types.json", import.meta.url)), "utf8")));

// Deterministic scripted run → golden final concept_states + completed scenes.
const script: ResponseInput[] = [
  { kind: "ack" }, { kind: "ack" }, { kind: "quiz_choice", choiceId: "b" },
  { kind: "critique", text: "claim_a small sample" }, { kind: "ack" },
  { kind: "ack" }, { kind: "ack" }, { kind: "confidence", value: 3 },
];

describe("golden parity — final learner state", () => {
  it("produces the expected concept mastery + completed scenes (timestamps normalized)", async () => {
    const deps = buildTestDeps();
    const s = new LessonSession(bundle, deps);
    await s.start();
    for (const input of script) await s.respond(input);
    const state = s.getState();
    // c1: the QUIZ alone is evidence. The critique is answered on this script too and the stub
    // still scores it 0.8, but since INT-STUDIUM-035 candidate 2 (owner's decision, 2026-09-10) an
    // offline keyword score no longer certifies — so it is counted as an UNGRADED attempt and moves
    // neither total_attempts nor total_correct. This golden is the ledger of that decision: before
    // it, a session that typed the cue words was recorded as two successes.
    expect(state.concept_states.c1).toMatchObject({
      total_attempts: 1, total_correct: 1, consecutive_errors: 0, ungraded_attempts: 1,
    });
    expect(state.scenes_completed).toEqual([
      "s-intro", "s-concept-1", "s-quiz-1", "s-critique", "s-discussion", "s-concept-2", "s-repro", "s-meta",
    ]);
    // empty because THIS script never replays (every answer is correct), not because the field is
    // inert: it used to be, and is now stamped from the session's own tally — see
    // session.prereq-gate-termination.test.ts.
    expect(state.scenes_replayed).toEqual({});
    // History timestamps come from FixedClock — assert they are normalizable ISO strings.
    for (const h of state.history) expect(() => new Date(h.timestamp).toISOString()).not.toThrow();
  });
});
