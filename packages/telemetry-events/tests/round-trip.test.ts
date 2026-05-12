import { describe, expect, it } from "vitest";
import {
  TelemetryEventSchema, LessonStartedSchema, QuizAnsweredSchema,
} from "../src/events";

describe("telemetry-events Zod schemas", () => {
  it("parses lesson_started event", () => {
    const raw = {
      event_id: "01923456-7890-1234-5678-abcdef012345",
      learner_pseudonym: "hmac:abc123",
      lesson_id: "demo-001",
      bundle_version: "1.0.0",
      client_timestamp: "2026-05-09T10:00:00Z",
      type: "lesson_started",
      bundle_uri: "file:///tmp/demo.zip",
    };
    const parsed = LessonStartedSchema.parse(raw);
    expect(parsed.type).toBe("lesson_started");
    expect(parsed.bundle_uri).toBe("file:///tmp/demo.zip");
  });

  it("rejects unknown event type", () => {
    const raw = {
      event_id: "01923456-7890-1234-5678-abcdef012345",
      learner_pseudonym: "hmac:abc",
      lesson_id: "x", bundle_version: "1.0.0",
      client_timestamp: "2026-05-09T10:00:00Z",
      type: "not_a_real_event",
    };
    expect(() => TelemetryEventSchema.parse(raw)).toThrow();
  });

  it("validates quiz_answered with all required fields", () => {
    const raw = {
      event_id: "01923456-7890-1234-5678-abcdef012345",
      learner_pseudonym: "hmac:abc",
      lesson_id: "x",
      bundle_version: "1.0.0",
      client_timestamp: "2026-05-09T10:00:00Z",
      type: "quiz_answered",
      scene_id: "s_quiz_1",
      item_id: "q1",
      correct: true,
      response_time_ms: 1234,
      confidence: 0.7,
    };
    const parsed = QuizAnsweredSchema.parse(raw);
    expect(parsed.correct).toBe(true);
    expect(parsed.confidence).toBeCloseTo(0.7);
  });
});
