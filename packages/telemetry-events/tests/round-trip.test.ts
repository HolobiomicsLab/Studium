import { describe, expect, it } from "vitest";
import {
  TelemetryEventSchema, LessonStartedSchema, QuizAnsweredSchema,
  ReasoningSignalSchema, AIAuditResultSchema,
  JournalEntrySubmittedSchema, CooperativeVoteSchema,
  CooperativeConvergenceSchema,
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

  describe("journal_entry_submitted (v0.4)", () => {
    const valid = {
      ...BASE,
      type: "journal_entry_submitted" as const,
      scene_id: "s_journal_1",
      entry_length: 420,
      revision_count: 1,
      is_revision: true,
    };

    it("parses a valid journal_entry_submitted", () => {
      const parsed = JournalEntrySubmittedSchema.parse(valid);
      expect(parsed.type).toBe("journal_entry_submitted");
      expect(parsed.entry_length).toBe(420);
      expect(parsed.revision_count).toBe(1);
      expect(parsed.is_revision).toBe(true);
    });

    it("parses via the discriminated union", () => {
      const ev = TelemetryEventSchema.parse(valid);
      expect(ev.type).toBe("journal_entry_submitted");
    });

    it("rejects negative entry_length", () => {
      expect(() => JournalEntrySubmittedSchema.parse({ ...valid, entry_length: -1 })).toThrow();
    });

    it("rejects negative revision_count", () => {
      expect(() => JournalEntrySubmittedSchema.parse({ ...valid, revision_count: -1 })).toThrow();
    });

    it("rejects non-integer counters", () => {
      expect(() => JournalEntrySubmittedSchema.parse({ ...valid, entry_length: 1.5 })).toThrow();
      expect(() => JournalEntrySubmittedSchema.parse({ ...valid, revision_count: 1.5 })).toThrow();
    });

    it("rejects missing field", () => {
      const { is_revision, ...rest } = valid;
      expect(() => JournalEntrySubmittedSchema.parse(rest)).toThrow();
    });
  });

  describe("cooperative_vote (v0.4)", () => {
    const valid = {
      ...BASE,
      type: "cooperative_vote" as const,
      question_id: "q_vote_1",
      group_size: 4,
      aggregate_only: true,
    };

    it("parses a valid cooperative_vote", () => {
      const parsed = CooperativeVoteSchema.parse(valid);
      expect(parsed.type).toBe("cooperative_vote");
      expect(parsed.group_size).toBe(4);
      expect(parsed.aggregate_only).toBe(true);
    });

    it("parses via the discriminated union", () => {
      const ev = TelemetryEventSchema.parse(valid);
      expect(ev.type).toBe("cooperative_vote");
    });

    it("accepts group_size at boundaries [2,6]", () => {
      expect(CooperativeVoteSchema.parse({ ...valid, group_size: 2 }).group_size).toBe(2);
      expect(CooperativeVoteSchema.parse({ ...valid, group_size: 6 }).group_size).toBe(6);
    });

    it("rejects group_size below 2", () => {
      expect(() => CooperativeVoteSchema.parse({ ...valid, group_size: 1 })).toThrow();
    });

    it("rejects group_size above 6", () => {
      expect(() => CooperativeVoteSchema.parse({ ...valid, group_size: 7 })).toThrow();
    });

    it("rejects non-integer group_size", () => {
      expect(() => CooperativeVoteSchema.parse({ ...valid, group_size: 3.5 })).toThrow();
    });

    it("rejects missing question_id", () => {
      const { question_id, ...rest } = valid;
      expect(() => CooperativeVoteSchema.parse(rest)).toThrow();
    });
  });

  describe("cooperative_convergence (v0.4)", () => {
    const valid = {
      ...BASE,
      type: "cooperative_convergence" as const,
      synthesis_id: "syn_1",
      group_size: 4,
      confidence_distribution_aggregated: [0, 1, 2, 1, 0],
      role_coverage: 0.75,
    };

    it("parses a valid cooperative_convergence", () => {
      const parsed = CooperativeConvergenceSchema.parse(valid);
      expect(parsed.type).toBe("cooperative_convergence");
      expect(parsed.confidence_distribution_aggregated).toHaveLength(5);
      expect(parsed.role_coverage).toBeCloseTo(0.75);
    });

    it("parses via the discriminated union", () => {
      const ev = TelemetryEventSchema.parse(valid);
      expect(ev.type).toBe("cooperative_convergence");
    });

    it("rejects group_size out of [2,6]", () => {
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, group_size: 1 })).toThrow();
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, group_size: 7 })).toThrow();
    });

    it("rejects confidence_distribution wrong length", () => {
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, confidence_distribution_aggregated: [0, 1, 2, 1] })).toThrow();
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, confidence_distribution_aggregated: [0, 1, 2, 1, 0, 0] })).toThrow();
    });

    it("rejects negative values in confidence_distribution", () => {
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, confidence_distribution_aggregated: [0, 1, -1, 1, 0] })).toThrow();
    });

    it("rejects non-integer values in confidence_distribution", () => {
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, confidence_distribution_aggregated: [0, 1, 1.5, 1, 0] })).toThrow();
    });

    it("rejects role_coverage out of [0,1]", () => {
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, role_coverage: 1.1 })).toThrow();
      expect(() => CooperativeConvergenceSchema.parse({ ...valid, role_coverage: -0.1 })).toThrow();
    });

    it("rejects missing synthesis_id", () => {
      const { synthesis_id, ...rest } = valid;
      expect(() => CooperativeConvergenceSchema.parse(rest)).toThrow();
    });
  });

  it("validates universe_selected (refs + option map only)", () => {
    const ev = { event_id: "11111111-1111-1111-1111-111111111111", learner_pseudonym: "p", lesson_id: "L1",
      bundle_version: "1.4:L1", client_timestamp: "2026-06-11T00:00:00+00:00",
      type: "universe_selected", universe_id: "remedial", active_decisions: { prereq_strictness: "lenient" } };
    expect(() => TelemetryEventSchema.parse(ev)).not.toThrow();
  });

  it("validates hint_requested (refs + scalar only)", () => {
    const ev = { event_id: "11111111-1111-1111-1111-111111111111", learner_pseudonym: "p", lesson_id: "L1",
      bundle_version: "1.4:L1", client_timestamp: "2026-06-11T00:00:00+00:00",
      type: "hint_requested", scene_id: "q1", hint_index: 0 };
    expect(() => TelemetryEventSchema.parse(ev)).not.toThrow();
  });
  it("rejects hint_requested with a negative hint_index", () => {
    const ev = { event_id: "11111111-1111-1111-1111-111111111111", learner_pseudonym: "p", lesson_id: "L1",
      bundle_version: "1.4:L1", client_timestamp: "2026-06-11T00:00:00+00:00",
      type: "hint_requested", scene_id: "q1", hint_index: -1 };
    expect(() => TelemetryEventSchema.parse(ev)).toThrow();
  });
});
