// packages/lesson-session/src/session.mastery.test.ts
import { describe, it, expect } from "vitest";
import { LessonSession } from "./session";
import { buildTestDeps, InMemoryMasteryClaimSink, InMemoryTelemetrySink, InMemoryEventLog } from "./testing";
import type { LessonBundle } from "@studium/lesson-bundle-schema";

function quiz(id: string) {
  return { id, type: "quiz", title: id, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
    question: "?", choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }],
    feedback_correct: "ok", feedback_incorrect: "no", hints: [] };
}
function bundle(): LessonBundle {
  return { schema_version: "1.4", bundle_id: "L1", source_plan_id: "p1",
    metadata: { title: "T", target: "L1", duration_minutes: 10, language: "fr", discipline: "x" },
    concepts: [{ id: "c", title: "C", description: "d", bloom_level_target: "understand" }],
    scenes: [quiz("q1"), quiz("q2")], rules: [], validated_by: "teacher", validated_at: "2026-06-11T00:00:00Z" } as unknown as LessonBundle;
}

describe("LessonSession — mastery claims at completion", () => {
  it("emits a local mastery claim for a concept mastered at >= 0.8", async () => {
    const sink = new InMemoryMasteryClaimSink();
    const s = new LessonSession(bundle(), buildTestDeps({ masteryClaimSink: sink }));
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "b" });   // q1 correct -> mastery 0.714
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" }); // q2 correct -> 0.8 -> complete
    expect(t.kind).toBe("complete");
    expect(sink.docs.length).toBe(1);
    const claim = sink.docs[0]!["@graph"].find((n: any) => n["@type"] === "asb:Claim") as any;
    expect(claim.object).toBe("c");
    expect(claim.subject).toBe("anon-test");            // StaticPseudonym
    expect(claim.domain_qualifier).toBe("demonstrates_mastery_of");
  });

  it("RGPD: mastery claims go ONLY to the mastery sink, never telemetry/eventLog", async () => {
    const sink = new InMemoryMasteryClaimSink();
    const telemetry = new InMemoryTelemetrySink();
    const eventLog = new InMemoryEventLog();
    const s = new LessonSession(bundle(), buildTestDeps({ masteryClaimSink: sink, telemetry, eventLog }));
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "b" });
    await s.respond({ kind: "quiz_choice", choiceId: "b" });
    expect(sink.docs.length).toBe(1);
    const tele = JSON.stringify(telemetry.events);
    const log = JSON.stringify(eventLog.records);
    expect(tele).not.toContain("demonstrates_mastery_of");
    expect(tele).not.toContain("asb:Claim");
    expect(log).not.toContain("demonstrates_mastery_of");
  });

  it("below the 0.8 bar -> no claim doc (even if a lenient universe lowered nav theta)", async () => {
    const sink = new InMemoryMasteryClaimSink();
    const s = new LessonSession(bundle(), buildTestDeps({ masteryClaimSink: sink }));
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "b" });   // q1 correct -> 0.714
    await s.respond({ kind: "quiz_choice", choiceId: "a" });   // q2 WRONG -> mastery drops; complete
    expect(sink.docs).toEqual([]);                              // 0.714-ish or lower < 0.8 -> no doc
  });

  it("no masteryClaimSink -> completion unchanged, no emission (backward compatible)", async () => {
    const s = new LessonSession(bundle(), buildTestDeps());     // no sink
    await s.start();
    await s.respond({ kind: "quiz_choice", choiceId: "b" });
    const t = await s.respond({ kind: "quiz_choice", choiceId: "b" });
    expect(t.kind).toBe("complete");                            // no throw, normal completion
  });
});
