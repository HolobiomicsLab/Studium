// Sprint verification fix wave (2026-10-30, lead decisions L-2 and L-7).
//
// L-2 (RFR-02): a learner who answered an author-keyed quiz wrong left the lesson without ever being
// shown the right answer. The verdict of a wrong quiz answer now carries the correct choice as
// reference data — key_points = [its text], reference_kind "correct_choice" — which the host holds back
// while the learner retries the item and releases with the sources when they leave it (I-2).
//
// L-7 (RFR-15, R-en-13, H7): `graded` says an answer was submitted, not that anything assessed it. The
// verdict now says who did: the author's key (a quiz choice, the verdict deck), a judge (an LLM
// evaluation, or an LLM audit judge's counts even when the pass itself was not certified), or none.
import { describe, expect, it } from "vitest";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { LessonSession } from "./session.js";
import { buildTestDeps } from "./testing.js";
import { StubCritiqueEvaluator } from "./adapters/critique-evaluator.js";
import { verdictDeck } from "./grading/deck.js";
import type { AuditJudge, CritiqueEvaluator } from "./ports.js";

const rubric = { completeness: 1, evidence_quality: 1, tone: 1 };
const base = (id: string, type: string, concepts = ["c"]) => ({
  id, type, title: id, objective_refs: ["c"], concept_refs: concepts, estimated_seconds: 0, adaptation_hooks: [],
});
const quiz = (id = "q") => ({
  ...base(id, "quiz"), question: "Quel gaz la plante fixe-t-elle ?",
  choices: [{ id: "a", text: "Le dioxygène", correct: false }, { id: "b", text: "Le dioxyde de carbone", correct: true }],
  feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
});
const explainBack = () => ({
  ...base("e", "explain_back"), prompt: "Explique.",
  key_points: [{ id: "kp", text: "Le point", cues: ["point"] }], model_explanation: "Le modèle.", rubric,
});
const concept = () => ({ ...base("k", "concept"), markdown: "Lis." });
const spotTheFlaw = <T extends object>(extra: T = {} as T) => ({
  ...base("s", "spot_the_flaw"), flawed_content: "N : 1s2 2s2 2p4.",
  claims: [{ id: "f-hund", text: "Les électrons 2p sont appariés", flaws_expected: ["hund"] }],
  model_correction: "N : 1s2 2s2 2p3.", rubric, ...extra,
});

function bundle(scenes: object[], concepts = [{ id: "c", title: "c", description: "d", bloom_level_target: "understand" }]): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "provenance", source_plan_id: "p",
    metadata: { title: "T", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts, scenes, rules: [], validated_by: "teacher", validated_at: "2026-10-30T00:00:00Z",
  } as unknown as LessonBundle;
}

async function answer(scenes: object[], input: object, deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator() })) {
  const session = new LessonSession(bundle(scenes), deps);
  await session.start();
  return session.respond(input as never);
}

const llm = (covered_ids: string[], score = 0.9): CritiqueEvaluator =>
  ({ async evaluate() { return { score, feedback: "judged", source: "llm" as const, covered_ids }; } });

describe("L-2 — a wrong quiz answer releases the correct choice as reference data", () => {
  it("wrong: key_points holds the correct choice's text, reference_kind correct_choice, no model answer", async () => {
    const t = await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "a" });
    expect(t.verdict).toMatchObject({ correct: false, key_points: ["Le dioxyde de carbone"], reference_kind: "correct_choice" });
    expect(t.verdict).not.toHaveProperty("model_answer");
    // The feedback is the author's incorrect-half only; it does not repeat the reference.
    expect(t.verdict?.feedback).toBe("Non");
  });

  it("right: no reference — the learner already chose it", async () => {
    const t = await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "b" });
    expect(t.verdict).not.toHaveProperty("key_points");
    expect(t.verdict).not.toHaveProperty("reference_kind");
  });

  it("a quiz with several correct choices names each of them", async () => {
    const scene = { ...quiz(), choices: [...quiz().choices, { id: "c", text: "Le CO2", correct: true }] };
    const t = await answer([scene, quiz("q2")], { kind: "quiz_choice", choiceId: "a" });
    expect(t.verdict?.key_points).toEqual(["Le dioxyde de carbone", "Le CO2"]);
  });
});

describe("L-7 — the verdict says who assessed the answer", () => {
  it("a quiz choice is assessed by the author's key", async () => {
    expect((await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "b" })).verdict?.assessed_by).toBe("key");
    expect((await answer([quiz(), quiz("q2")], { kind: "quiz_choice", choiceId: "a" })).verdict?.assessed_by).toBe("key");
  });

  it("the verdict deck is assessed by the key", async () => {
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }], verdict_deck: true });
    const verdicts = verdictDeck(scene.claims, scene.sound_claims, scene.id).map((item) => ({ token: item.token, flagged: item.flawed }));
    expect((await answer([scene], { kind: "flaw_verdicts", verdicts })).verdict?.assessed_by).toBe("key");
  });

  it("a production answer no judge assessed says none, and keeps graded: true (an answer was submitted)", async () => {
    const t = await answer([explainBack(), quiz()], { kind: "explanation", text: "le point" });
    expect(t.verdict).toMatchObject({ graded: true, assessed_by: "none" });
    expect(t.verdict).not.toHaveProperty("correct");
  });

  it("an LLM evaluation is assessed by a judge", async () => {
    const deps = buildTestDeps({ critiqueEvaluator: llm(["kp"]) });
    const t = await answer([explainBack(), quiz()], { kind: "explanation", text: "x" }, deps);
    expect(t.verdict).toMatchObject({ correct: true, assessed_by: "judge" });
  });

  it("H7: an LLM audit judge's counts are a judge's, even when the evaluator degraded and certified no pass", async () => {
    const auditJudge: AuditJudge = { async judge() { return { caught_flaw_ids: ["f-hund"], wrongly_flagged_sound_ids: [], source: "llm" }; } };
    const deps = buildTestDeps({ critiqueEvaluator: new StubCritiqueEvaluator(), auditJudge });
    const scene = spotTheFlaw({ sound_claims: [{ id: "ok", text: "N a 7 électrons" }] });
    const t = await answer([scene], { kind: "flaw_report", text: "hund" }, deps);
    expect(t.verdict).not.toHaveProperty("correct");
    expect(t.verdict?.assessed_by).toBe("judge");
  });

  it("an acknowledged reading scene is assessed by nobody", async () => {
    const t = await answer([concept(), quiz()], { kind: "ack" });
    expect(t.verdict).toMatchObject({ graded: false, assessed_by: "none" });
  });
});
