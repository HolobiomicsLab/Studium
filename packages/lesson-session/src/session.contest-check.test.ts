// Check questions inserted into a lesson (INT-STUDIUM-058 § 2.7, contesting a concept): the session
// serves the scenes asked for, grades each answer as usual, then resumes where the learner was. A
// declaration moves nothing by itself, and no scene of the lesson is skipped because of a check.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps, InMemoryEventLog } from "./testing.js";

const quiz = (id: string, concept: string) => ({
  id, type: "quiz", title: id, objective_refs: [concept], concept_refs: [concept], estimated_seconds: 0, adaptation_hooks: [],
  question: "?", choices: [{ id: "wrong", text: "W", correct: false }, { id: "right", text: "R", correct: true }],
  feedback_correct: "correct", feedback_incorrect: "incorrect", hints: [],
});
const concept = (id: string, ref: string) =>
  ({ id, type: "concept", title: id, objective_refs: [ref], concept_refs: [ref], estimated_seconds: 0, adaptation_hooks: [], markdown: "concept" });
const lesson = () => ({
  schema_version: "1.4", bundle_id: "contest-check", source_plan_id: "p",
  metadata: { title: "T", target: "L1", duration_minutes: 10, language: "en", discipline: "x" },
  concepts: ["a", "b"].map((id) => ({ id, title: id, description: "d", bloom_level_target: "understand" })),
  scenes: [concept("c-a", "a"), quiz("q-a", "a"), concept("c-b", "b"), quiz("q-b1", "b"), quiz("q-b2", "b")],
  rules: [], validated_by: "teacher", validated_at: "2026-11-06T00:00:00Z",
}) as unknown as LessonBundle;

const RIGHT = { kind: "quiz_choice", choiceId: "right" } as const;
const WRONG = { kind: "quiz_choice", choiceId: "wrong" } as const;
const mastery = (session: LessonSession) => JSON.stringify(session.getState().concept_states);

describe("check questions", () => {
  it("serves the scenes asked for, then returns to the scene the learner was on, skipping nothing", async () => {
    const session = new LessonSession(lesson(), buildTestDeps());
    await session.start();
    const before = mastery(session);
    const first = session.insertChecks(["q-b1", "q-b2"]);
    expect(first.scene.id).toBe("q-b1");
    expect(session.checkPending()).toBe(true);
    expect(mastery(session)).toBe(before);                           // inserting a check moves no mastery

    const second = await session.respond(RIGHT);
    expect(second).toMatchObject({ kind: "next", verdict: { scene_id: "q-b1", correct: true }, navigation: { kind: "advance", rule_id: "contest_check" } });
    expect("presentation" in second && second.presentation.scene.id).toBe("q-b2");
    expect(mastery(session)).not.toBe(before);                       // the answer is graded as any answer

    const back = await session.respond(WRONG);
    expect(back).toMatchObject({ kind: "next", verdict: { scene_id: "q-b2", correct: false }, navigation: { kind: "advance", rule_id: "contest_check_done" } });
    expect("presentation" in back && back.presentation.scene.id).toBe("c-a");   // where the learner was
    expect(session.checkPending()).toBe(false);

    // The lesson then plays every one of its scenes, the two check scenes included.
    const served: string[] = [];
    let t = await session.respond({ kind: "ack" });
    while (t.kind !== "complete") {
      const id = "presentation" in t ? t.presentation.scene.id : "";
      served.push(id);
      t = await session.respond(id.startsWith("q-") ? RIGHT : { kind: "ack" });
    }
    expect(served).toEqual(["q-a", "c-b", "q-b1", "q-b2"]);
    // The path holds the checks as steps of their own, in the order served.
    expect(session.learnerPath().steps.map((step) => step.scene_id)).toEqual(["q-b1", "q-b2", "c-a", "q-a", "c-b", "q-b1", "q-b2"]);
    expect(session.answerFacts().map((fact) => fact.scene_id)).toEqual(["q-b1", "q-b2", "q-a", "q-b1", "q-b2"]);
  });

  it("refuses a check on an unknown scene, an empty one, a second one, and one before the start or after the end", async () => {
    const session = new LessonSession(lesson(), buildTestDeps());
    expect(() => session.insertChecks(["q-a"])).toThrow();
    await session.start();
    expect(() => session.insertChecks([])).toThrow(/at least one/);
    expect(() => session.insertChecks(["nowhere"])).toThrow(/nowhere/);
    session.insertChecks(["q-a"]);
    expect(() => session.insertChecks(["q-b1"])).toThrow(/already/);
  });

  it("records a contest and its outcome in the event log, without any of the learner's words", async () => {
    const eventLog = new InMemoryEventLog();
    const session = new LessonSession(lesson(), buildTestDeps({ eventLog }));
    await session.start();
    await session.recordContest({ concept_id: "b", claim: "known", outcome: "refuted", scene_ids: ["q-b1", "q-b2"], results: [true, false] });
    const event = eventLog.records.find((e) => e.event_type === "concept_contested");
    expect(event).toMatchObject({
      lesson_id: "contest-check",
      payload: { concept_id: "b", claim: "known", outcome: "refuted", scene_ids: ["q-b1", "q-b2"], results: [true, false] },
    });
  });
});
