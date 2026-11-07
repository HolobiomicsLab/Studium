// Contesting a concept (INT-STUDIUM-058 § 2.7, F10): « I know it » of a concept not acquired, « I am
// not sure » of an acquired one. The host answers with check questions taken from the lesson, graded
// as any answer; the declaration itself moves no mastery and skips no scene. Played on
// fixtures/atomistique-l1 by a labelled synthetic learner (the key is read from the fixture).
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { checkScenes, claimFor, contestOutcome } from "./contest.js";
import { SessionHost } from "./host.js";

const FIXTURES = resolve("../../fixtures");
const ATOMS = "atomistique-l1/lesson.json";
const LEARNER = "auto-test-contest";
const authored = JSON.parse(readFileSync(resolve(FIXTURES, ATOMS), "utf8")) as LessonBundle;
type Choice = { id: string; text: string };

const smallBase = (id: string, concept: string) => ({
  id, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const smallConcept = (id: string, concept: string) => ({ ...smallBase(id, concept), type: "concept", markdown: "Le cours." });
const smallQuiz = (id: string, concept: string) => ({
  ...smallBase(id, concept), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "Oui", feedback_incorrect: "Non", hints: [],
});
const smallLesson = {
  schema_version: "1.4", bundle_id: "contest-small", source_plan_id: "p",
  metadata: { title: "Contest small", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: [
    { id: "c-served", title: "Notion servie", description: "d", bloom_level_target: "understand" },
    { id: "c-later", title: "Notion suivante", description: "d", bloom_level_target: "understand" },
    { id: "c-nokey", title: "Notion sans clé", description: "d", bloom_level_target: "understand" },
  ],
  scenes: [
    smallConcept("s-served", "c-served"), smallQuiz("s-q1", "c-served"), smallQuiz("s-q2", "c-served"),
    smallConcept("s-later", "c-later"), smallQuiz("s-q3", "c-later"), smallConcept("s-nokey", "c-nokey"),
  ],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
};

async function startSmall() {
  const root = mkdtempSync(join(tmpdir(), "contest-small-"));
  writeFileSync(join(root, "lesson.json"), JSON.stringify(smallLesson));
  const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
  const sid = (await host.create("lesson.json", LEARNER)).sessionId;
  const answer = (right: boolean) => {
    const shown = host.currentPresentation(sid).scene as unknown as { id: string; choices: Choice[] };
    const scene = smallLesson.scenes.find((s) => s.id === shown.id) as unknown as { choices: Array<{ text: string; correct: boolean }> };
    const wanted = scene.choices.find((choice) => choice.correct === right)!.text;
    return host.respond(sid, { kind: "quiz_choice", choiceId: shown.choices.find((c) => c.text === wanted)!.id }, "fast");
  };
  return { host, sid, answer, root };
}

async function start() {
  const host = new SessionHost({ bundlesRoot: FIXTURES, live: false, dataDir: null });
  const sid = (await host.create(ATOMS, LEARNER)).sessionId;
  const sceneId = () => host.currentPresentation(sid).scene.id;
  /** Answer the quiz on screen right or wrong: the key is the fixture's, the ids are the ones displayed. */
  const answer = (right: boolean) => {
    const shown = host.currentPresentation(sid).scene as unknown as { id: string; choices: Choice[] };
    const key = (authored.scenes.find((s) => s.id === shown.id) as unknown as { choices: Array<{ text: string; correct: boolean }> }).choices;
    const wanted = key.find((choice) => choice.correct === right)!.text;
    return host.respond(sid, { kind: "quiz_choice", choiceId: shown.choices.find((c) => c.text === wanted)!.id, confidence: 2 }, "fast");
  };
  const mastery = () => JSON.stringify(host.getState(sid).concept_states);
  const contest = () => host.conceptMapRecord(sid)!.contest;
  return { host, sid, sceneId, answer, mastery, contest };
}

describe("the rules of a contest", () => {
  it("takes « I am not sure » of an acquired concept and « I know it » of any other", () => {
    expect(claimFor("acquired")).toBe("unsure");
    for (const state of ["to_review", "current", "seen", "upcoming"] as const) expect(claimFor(state)).toBe("known");
  });

  it("asks key-graded questions of the concept, two at most, the unanswered ones first, never the one on screen", () => {
    const none = { currentSceneId: null, answered: new Set<string>() };
    expect(checkScenes(authored, "c-particules", none)).toEqual(["s1-quiz-fer", "s9-rappel-carbone14"]);
    expect(checkScenes(authored, "c-particules", { currentSceneId: null, answered: new Set(["s1-quiz-fer"]) }))
      .toEqual(["s9-rappel-carbone14", "s1-quiz-fer"]);
    expect(checkScenes(authored, "c-particules", { currentSceneId: "s1-quiz-fer", answered: new Set() })).toEqual(["s9-rappel-carbone14"]);
    expect(checkScenes(authored, "c-periodicite", none)).toEqual(["s6-quiz-tendance"]);   // one key-graded scene only
    expect(checkScenes(authored, "c-geometrie", none)).toEqual([]);                       // production scenes only
    expect(checkScenes(authored, "nowhere", none)).toEqual([]);
  });

  it("confirms a claim when both answers go its way, refutes it otherwise, and says partial of a single question", () => {
    expect(contestOutcome("known", [true, true])).toBe("confirmed");
    expect(contestOutcome("known", [true, false])).toBe("refuted");
    expect(contestOutcome("known", [false, false])).toBe("refuted");
    expect(contestOutcome("unsure", [false, false])).toBe("confirmed");
    expect(contestOutcome("unsure", [false, true])).toBe("refuted");
    expect(contestOutcome("unsure", [true, true])).toBe("refuted");
    expect(contestOutcome("known", [true])).toBe("partial");
    expect(contestOutcome("unsure", [false])).toBe("partial");
  });
});

describe("contesting a concept in a lesson", () => {
  it("« I know it »: no mastery moves on the claim, two check questions follow, then the lesson resumes where it was", async () => {
    const t = await start();
    await t.host.respond(t.sid, { kind: "ack" });                    // the first concept is served
    const was = t.sceneId();
    expect(was).toBe("s1-concept-particules");
    const before = t.mastery();
    expect(t.contest()).toMatchObject({ pending: null, history: [] });
    expect(t.contest().questions).toMatchObject({ "c-particules": 2, "c-periodicite": 1, "c-geometrie": 0 });

    const started = await t.host.contest(t.sid, "c-particules", "known", "fast");
    expect(started).toMatchObject({ concept_id: "c-particules", claim: "known", questions: 2 });
    expect(started.presentation.scene.id).toBe("s1-quiz-fer");
    expect(t.mastery()).toBe(before);                                // a declaration is not evidence
    expect(t.contest().pending).toEqual({ concept_id: "c-particules", claim: "known", asked: 2, answered: 0 });
    expect(Object.values(t.contest().questions).every((n) => n === 0)).toBe(true);   // one contest at a time

    const first = await t.answer(true);
    expect(first.verdict).toMatchObject({ scene_id: "s1-quiz-fer", correct: true, assessed_by: "key" });
    expect(t.sceneId()).toBe("s9-rappel-carbone14");                 // a second question, from another scene
    expect(t.mastery()).not.toBe(before);                            // each answer is graded as any answer
    expect(t.contest().pending).toMatchObject({ answered: 1 });

    const second = await t.answer(true);
    expect(second.contest).toEqual({
      concept_id: "c-particules", claim: "known", outcome: "confirmed", scene_ids: ["s1-quiz-fer", "s9-rappel-carbone14"], results: [true, true],
    });
    expect(t.sceneId()).toBe(was);                                   // back where the learner was
    expect(t.contest()).toMatchObject({ pending: null, history: [second.contest] });

    // Nothing was skipped: the lesson goes on with its next scene.
    await t.host.respond(t.sid, { kind: "ack" });
    expect(t.sceneId()).toBe(authored.scenes[2]!.id);
    // The checks are steps of the path and evidence on the map.
    const record = t.host.conceptMapRecord(t.sid)!;
    expect(record.path.filter((step) => ["s1-quiz-fer", "s9-rappel-carbone14"].includes(step.scene_id)).map((step) => step.scene_id))
      .toEqual(["s1-quiz-fer", "s9-rappel-carbone14"]);
    expect(record.evidence.map((fact) => fact.scene_id)).toEqual(["s1-quiz-fer", "s9-rappel-carbone14"]);
    // The agent's next brief says a contest was made, and through which lane.
    expect(t.host.companionBrief(t.sid).since_last.find((act) => act.act === "contest"))
      .toEqual({ scene_id: was, act: "contest", lane: "fast" });
  });

  it("refutes « I know it » when an answer is wrong, and a check answer releases no reference", async () => {
    const t = await start();
    await t.host.respond(t.sid, { kind: "ack" });
    await t.host.contest(t.sid, "c-particules", "known");
    const wrong = await t.answer(false);
    expect(wrong.verdict).toMatchObject({ correct: false });
    // The question may come again in the lesson: its key stays with the author.
    expect(wrong.verdict).not.toHaveProperty("reference_kind");
    expect(wrong.verdict).not.toHaveProperty("correct_choice");
    expect(wrong.contest).toBeUndefined();
    const last = await t.answer(true);
    expect(last.contest).toMatchObject({ outcome: "refuted", results: [false, true] });
    expect(last.verdict).not.toHaveProperty("reference_kind");
  });

  it("refuses an upcoming concept until the session reaches it, then contests it with its one key-graded question", async () => {
    const { host, sid, answer, root } = await startSmall();
    try {
      const refused = (concept: string, claim: "known" | "unsure") =>
        host.contest(sid, concept, claim).then(() => "accepted", (error: Error) => error.message);
      expect(await refused("c-later", "known"))
        .toBe('"c-later" has not been shown yet: contest it once the session reaches it');
      await host.respond(sid, { kind: "ack" });                     // s-q1
      await answer(true);                                           // s-q2
      await answer(true);                                           // s-later, c-later is current
      expect(host.conceptMap(sid)!.nodes.find((node) => node.id === "c-later")!.state).toBe("current");
      const started = await host.contest(sid, "c-later", "known", "fast");
      expect(started.questions).toBe(1);
      const only = await answer(true);
      expect(only.contest).toMatchObject({ outcome: "partial", scene_ids: ["s-q3"], results: [true] });
      await host.respond(sid, { kind: "ack" });                     // s-q3
      await answer(true);                                           // s-nokey
      expect(await refused("c-nokey", "known")).toBe('this lesson has no question graded against a key on "c-nokey"');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("« I am not sure » of an acquired concept: confirmed when both answers are wrong", async () => {
    const t = await start();
    await t.host.respond(t.sid, { kind: "ack" });
    await t.host.respond(t.sid, { kind: "ack" });
    expect(t.sceneId()).toBe("s1-quiz-fer");
    await t.answer(true);
    // The written audit of the same concept, which nobody assesses here; then the next concept opens.
    await t.host.respond(t.sid, { kind: "reply", text: "Le résumé confond deux nombres." });
    const state = t.host.conceptMapRecord(t.sid)!.map.nodes.find((node) => node.id === "c-particules")!.state;
    expect(state).toBe("acquired");
    const was = t.sceneId();
    const before = t.mastery();
    const started = await t.host.contest(t.sid, "c-particules", "unsure");
    expect(t.mastery()).toBe(before);
    expect(started.presentation.scene.id).toBe("s9-rappel-carbone14");   // the question not yet answered first
    await t.answer(false);
    expect(t.sceneId()).toBe("s1-quiz-fer");
    const last = await t.answer(false);
    expect(last.contest).toMatchObject({ claim: "unsure", outcome: "confirmed", results: [false, false] });
    expect(t.sceneId()).toBe(was);
  });

  it("refuses, in one line, a claim the state does not take, a concept without a key-graded question, an unknown one and a second contest", async () => {
    const t = await start();
    await t.host.respond(t.sid, { kind: "ack" });                    // the first concept is served
    const refused = (concept: string, claim: "known" | "unsure") =>
      t.host.contest(t.sid, concept, claim).then(() => "accepted", (error: Error) => error.message);
    expect(await refused("c-particules", "unsure")).toMatch(/not acquired.*"known"/);
    expect(await refused("c-geometrie", "known")).toMatch(/has not been shown yet/);
    expect(await refused("nowhere", "known")).toMatch(/no concept "nowhere"/);
    await t.host.contest(t.sid, "c-particules", "known");
    expect(await refused("c-periodicite", "known")).toMatch(/already/);
    for (const message of [await refused("c-periodicite", "known")]) expect(message).not.toContain("\n");
  });
});
