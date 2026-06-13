// session.tutor.test.ts
import { describe, it, expect } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryTelemetrySink, StubReasoningScorer } from "./testing.js";
import { StubSocraticTutor } from "./adapters/socratic-tutor.js";

function discussionBundle(seed: string): LessonBundle {
  return { schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c1", title: "C1", description: "d", bloom_level_target: "understand" }],
    scenes: [{ id: "d1", type: "discussion", title: "D", objective_refs: [], concept_refs: ["c1"],
      estimated_seconds: 0, adaptation_hooks: [], topic: "Peroxysomes", seed_claim: seed,
      target_signals: ["hypothesis"], max_turns: 5 }],
    rules: [], validated_by: "t", validated_at: "2026-06-10T10:00:00Z" } as unknown as LessonBundle;
}
const evs = (d: ReturnType<typeof buildTestDeps>) => (d.telemetry as InMemoryTelemetrySink).events;

describe("submitTurn — Socratic tutor", () => {
  it("with NO tutor dep (flag off): emits reasoning_signal only, no tutor_move", async () => {
    const deps = buildTestDeps({ reasoningScorer: new StubReasoningScorer({ signal: "hypothesis", confidence: 0.8 }) });
    const s = new LessonSession(discussionBundle("le peroxysome dégrade h2o2"), deps);
    await s.start();
    await s.submitTurn("je crois que…");
    expect(evs(deps).some((e) => e.type === "tutor_move")).toBe(false);
    expect(evs(deps).some((e) => e.type === "reasoning_signal")).toBe(true);
  });

  it("with a stub tutor: emits tutor_move carrying the ORIGINAL move_kind", async () => {
    const deps = buildTestDeps({
      reasoningScorer: new StubReasoningScorer({ signal: "hypothesis", confidence: 0.8 }),
      socraticTutor: new StubSocraticTutor(),
    });
    const s = new LessonSession(discussionBundle("le peroxysome dégrade h2o2"), deps);
    await s.start();
    await s.submitTurn("je crois que…");
    const tm = evs(deps).find((e) => e.type === "tutor_move") as Record<string, unknown> | undefined;
    expect(tm).toBeDefined();
    expect(tm!["move_kind"]).toBe("invite_test");
    expect(tm!["reveal_blocked"]).toBe(false);
  });

  it("blocks a revealing tutor move: reveal_blocked true + learner gets the faded fallback", async () => {
    // a tutor that leaks the seed_claim
    const leaky = { async respond() { return { text: "le peroxysome dégrade h2o2, voilà", move_kind: "invite_test" as const, revealed: false }; } };
    const deps = buildTestDeps({
      reasoningScorer: new StubReasoningScorer({ signal: "hypothesis", confidence: 0.8 }),
      socraticTutor: leaky,
    });
    const s = new LessonSession(discussionBundle("le peroxysome dégrade h2o2"), deps);
    await s.start();
    await s.submitTurn("je crois que…");
    const tm = evs(deps).find((e) => e.type === "tutor_move") as Record<string, unknown>;
    expect(tm["revealed"]).toBe(true);
    expect(tm["reveal_blocked"]).toBe(true);
    // learner-facing text is the safe fallback, not the leak
    expect(s.getLastTutorMove()!.text).not.toContain("dégrade h2o2");
  });

  it("treats a low-confidence non-scaffold move as a guardrail violation (reveal_blocked)", async () => {
    const wrong = { async respond() { return { text: "Qu'observerais-tu ?", move_kind: "invite_test" as const, revealed: false }; } };
    const deps = buildTestDeps({
      reasoningScorer: new StubReasoningScorer({ signal: "hypothesis", confidence: 0.2 }),
      socraticTutor: wrong,
    });
    const s = new LessonSession(discussionBundle("seed claim phrase"), deps);
    await s.start();
    await s.submitTurn("euh…");
    const tm = evs(deps).find((e) => e.type === "tutor_move") as Record<string, unknown>;
    expect(tm["reveal_blocked"]).toBe(true);
  });
});
