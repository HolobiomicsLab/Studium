import { describe, expect, it } from "vitest";
import {
  TelemetryEventSchema, LessonStartedSchema, QuizAnsweredSchema,
  ReasoningSignalSchema, AIAuditResultSchema,
} from "../src/events";

const BASE = {
  event_id: "01923456-7890-1234-5678-abcdef012345",
  learner_pseudonym: "hmac:abc",
  lesson_id: "demo",
  bundle_version: "1.0.0",
  client_timestamp: "2026-05-09T10:00:00Z",
};

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

  describe("reasoning_signal (M5.9)", () => {
    const valid = {
      ...BASE,
      type: "reasoning_signal" as const,
      scene_id: "s_discuss_1",
      signal: "justification" as const,
      confidence: 0.82,
      turn_index: 3,
    };

    it("parses a valid reasoning_signal", () => {
      const parsed = ReasoningSignalSchema.parse(valid);
      expect(parsed.type).toBe("reasoning_signal");
      expect(parsed.signal).toBe("justification");
      expect(parsed.confidence).toBeCloseTo(0.82);
      expect(parsed.turn_index).toBe(3);
    });

    it("accepts all 5 valid signal labels via the union", () => {
      for (const signal of ["justification", "hypothesis", "question", "counterexample", "synthesis"] as const) {
        const ev = TelemetryEventSchema.parse({ ...valid, signal });
        expect(ev.type).toBe("reasoning_signal");
      }
    });

    it("rejects invalid signal label", () => {
      expect(() => ReasoningSignalSchema.parse({ ...valid, signal: "wrong" })).toThrow();
    });

    it("rejects confidence out of [0,1]", () => {
      expect(() => ReasoningSignalSchema.parse({ ...valid, confidence: 1.5 })).toThrow();
      expect(() => ReasoningSignalSchema.parse({ ...valid, confidence: -0.1 })).toThrow();
    });

    it("rejects negative or non-integer turn_index", () => {
      expect(() => ReasoningSignalSchema.parse({ ...valid, turn_index: -1 })).toThrow();
      expect(() => ReasoningSignalSchema.parse({ ...valid, turn_index: 1.5 })).toThrow();
    });

    it("rejects missing scene_id", () => {
      const { scene_id, ...rest } = valid;
      expect(() => ReasoningSignalSchema.parse(rest)).toThrow();
    });
  });

  describe("ai_audit_result", () => {
    const valid = {
      ...BASE,
      type: "ai_audit_result" as const,
      scene_id: "s_audit_1",
      planted_errors: 5,
      true_positives: 3,
      false_positives: 1,
      missed: 2,
    };

    it("parses a valid ai_audit_result", () => {
      const parsed = AIAuditResultSchema.parse(valid);
      expect(parsed.type).toBe("ai_audit_result");
      expect(parsed.planted_errors).toBe(5);
      expect(parsed.true_positives).toBe(3);
      expect(parsed.false_positives).toBe(1);
      expect(parsed.missed).toBe(2);
    });

    it("parses via the discriminated union", () => {
      const ev = TelemetryEventSchema.parse(valid);
      expect(ev.type).toBe("ai_audit_result");
    });

    it("rejects negative counters", () => {
      expect(() => AIAuditResultSchema.parse({ ...valid, true_positives: -1 })).toThrow();
      expect(() => AIAuditResultSchema.parse({ ...valid, planted_errors: -1 })).toThrow();
      expect(() => AIAuditResultSchema.parse({ ...valid, false_positives: -1 })).toThrow();
      expect(() => AIAuditResultSchema.parse({ ...valid, missed: -1 })).toThrow();
    });

    it("rejects non-integer counters", () => {
      expect(() => AIAuditResultSchema.parse({ ...valid, true_positives: 1.5 })).toThrow();
    });

    it("rejects missing field", () => {
      const { missed, ...rest } = valid;
      expect(() => AIAuditResultSchema.parse(rest)).toThrow();
    });
  });
});
