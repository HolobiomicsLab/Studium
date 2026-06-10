// packages/lesson-session/src/telemetry.test.ts
import { describe, it, expect } from "vitest";
import { enrichEvent, bundleVersionOf, type TelemetryContext } from "./telemetry.js";
import type { Clock, IdGen } from "./ports.js";

const clock: Clock = { now: () => "2026-06-10T00:00:00.000Z" };
let seq = 0;
const idGen: IdGen = { uuid: () => `id-${seq++}` };
const ctx: TelemetryContext = { learnerPseudonym: "anon", lessonId: "L1", bundleVersion: "1.4:L1@2026-05-08T10:00:00Z" };

describe("telemetry", () => {
  it("enrichEvent fills the 5 envelope fields, preserves payload", () => {
    seq = 0;
    const ev = enrichEvent({ type: "lesson_started", bundle_uri: "L1" }, ctx, clock, idGen);
    expect(ev).toMatchObject({
      type: "lesson_started", bundle_uri: "L1",
      event_id: "id-0", learner_pseudonym: "anon", lesson_id: "L1",
      bundle_version: "1.4:L1@2026-05-08T10:00:00Z", client_timestamp: "2026-06-10T00:00:00.000Z",
    });
  });
  it("bundleVersionOf builds the M5.7 convention string", () => {
    expect(bundleVersionOf({ schema_version: "1.4", bundle_id: "L1", validated_at: "2026-05-08T10:00:00Z" }))
      .toBe("1.4:L1@2026-05-08T10:00:00Z");
  });
});
