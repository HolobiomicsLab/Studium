// The exportable record behind the concept map, on a self-study lesson drafted from a conversation
// source (labelled synthetic learner; the key is known to the test because it wrote the draft).
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLesson } from "./authoring-draft/build.js";
import { prepareSources } from "./authoring-draft/source-set.js";
import { FRENCH_SOURCE, P1, P2 } from "./authoring-draft/test-fixtures.js";
import { CONCEPT_MAP_RECORD_SCHEMA, type RecordScene } from "./concept-map-record.js";
import { SessionHost } from "./host.js";

const LEARNER = "auto-test-map-record";
const NOW = new Date("2026-11-06T09:00:00.000Z");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const RIGHT = "Du partage des mêmes croyances";
const QUIZ_QUOTE = "la cohésion vient de ce que tous partagent les mêmes croyances";

/** A two-concept lesson whose passages come from a conversation; returns a host over its library. */
async function hostWithLesson(options: { library?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "map-record-"));
  roots.push(root);
  const set = await prepareSources(root, [{ ...FRENCH_SOURCE, kind: "conversation" }],
    { goal: "Distinguer les deux formes de solidarité", language: "fr" });
  const created = await createLesson(root, {
    source_set_id: set.source_set_id,
    draft: {
      title: "Solidarité mécanique et organique", language: "fr", goal: "Distinguer les deux formes de solidarité",
      concepts: [
        { id: "c-mecanique", label: "Solidarité mécanique", bloom: "understand" },
        { id: "c-organique", label: "Solidarité organique", bloom: "understand", prerequisites: ["c-mecanique"] },
      ],
      scenes: [
        { type: "intro", title: "Deux façons de tenir ensemble", concept_refs: ["c-mecanique"],
          markdown: "Cette leçon compare deux formes de cohésion sociale.", quotes: [] },
        { type: "quiz", title: "D'où vient la cohésion ?", concept_refs: ["c-mecanique"],
          question: "Dans la solidarité mécanique, d'où vient la cohésion ?",
          choices: [
            { text: RIGHT, correct: true },
            { text: "De la spécialisation des fonctions", correct: false },
            { text: "D'un contrat entre individus", correct: false },
          ],
          feedback_correct: "Oui : la cohésion vient de la ressemblance.",
          feedback_incorrect: "Relisez le passage sur la ressemblance.",
          quotes: [{ passage_id: P1, text: QUIZ_QUOTE }] },
        { type: "concept", title: "La différence", concept_refs: ["c-organique"],
          markdown: "Quand le travail se divise, chacun dépend des autres.",
          quotes: [{ passage_id: P2, text: "chacun dépend des autres parce qu’il ne fait pas ce qu’ils font" }] },
        { type: "explain_back", title: "Expliquer la solidarité organique", concept_refs: ["c-organique"],
          prompt: "Expliquez avec vos mots ce qui tient ensemble une société où le travail est divisé.",
          key_points: [
            { text: "Les individus se spécialisent", cues: ["spécialis", "différen"] },
            { text: "Chacun dépend des autres", cues: ["dépend", "interdépend"] },
          ],
          model_explanation: "Le travail divisé spécialise les individus ; chacun dépend alors des autres.",
          quotes: [{ passage_id: P2, text: "les fonctions se spécialisent et les individus deviennent différents" }] },
      ],
    },
  }, { now: () => NOW });
  if (!created.ok) throw new Error(`draft refused: ${JSON.stringify(created)}`);
  const host = new SessionHost({
    bundlesRoot: root, live: false, dataDir: null, ...(options.library === false ? {} : { libraryRoot: root }),
  });
  const start = await host.create(created.course_ref, LEARNER);
  return { host, root, sid: start.sessionId, lessonPath: created.lesson_path };
}

const sceneOfType = (scenes: RecordScene[], type: string) => scenes.find((scene) => scene.type === type)!;

async function answerQuiz(host: SessionHost, sid: string, text: string) {
  const scene = host.currentPresentation(sid).scene as { choices: { id: string; text: string }[] };
  return host.respond(sid, { kind: "quiz_choice", choiceId: scene.choices.find((c) => c.text === text)!.id, confidence: 3 });
}

describe("concept map record", () => {
  it("says what each scene rests on, and quotes a passage only once its scene is left", async () => {
    const { host, sid, lessonPath } = await hostWithLesson();
    await host.respond(sid, { kind: "ack" });                       // intro → the quiz is on screen
    const before = host.conceptMapRecord(sid)!;
    expect(before.schema).toBe(CONCEPT_MAP_RECORD_SCHEMA);
    expect(before.lesson).toMatchObject({ title: "Solidarité mécanique et organique", language: "fr" });
    expect(before.lesson.lesson_sha256).toBe(createHash("sha256").update(readFileSync(lessonPath)).digest("hex"));
    expect(before.authoring).toMatchObject({
      mode: "self_study", drafted_by: "agent", validated: false, judge: false, from_conversation: true,
    });
    const quizBefore = sceneOfType(before.scenes, "quiz");
    expect(quizBefore).toMatchObject({ key_class: "author_keyed", served: false, passages_released: false, concept_ids: ["c-mecanique"] });
    expect(quizBefore.sources).toEqual([expect.objectContaining({ origin: "conversation", title: FRENCH_SOURCE.title })]);
    expect(JSON.stringify(before)).not.toContain(QUIZ_QUOTE);

    await answerQuiz(host, sid, RIGHT);
    const after = host.conceptMapRecord(sid)!;
    expect(sceneOfType(after.scenes, "quiz")).toMatchObject({ served: true, passages_released: true });
    expect(sceneOfType(after.scenes, "quiz").sources[0]!.quote).toBe(QUIZ_QUOTE);
    expect(sceneOfType(after.scenes, "explain_back")).toMatchObject({ key_class: "production", served: false, passages_released: false });
    expect(sceneOfType(after.scenes, "explain_back").sources[0]!.quote).toBeUndefined();
    expect(after.path).toEqual([
      { step: 1, scene_id: before.scenes[0]!.scene_id, concept_id: "c-mecanique", answered: false, correct: null,
        assessed_by: null, navigation: { kind: "advance", rule_id: null } },
      { step: 2, scene_id: quizBefore.scene_id, concept_id: "c-mecanique", answered: true, correct: true,
        // The next scene needs this concept: a first right answer credits the prerequisite.
        assessed_by: "key", navigation: { kind: "gate_passed", rule_id: "graph_prereq_gate_passed" } },
    ]);
    expect(after.session).toEqual({ completed: false, steps: 2 });
    expect(after.map.nodes.map((node) => node.state)).toEqual(["acquired", "current"]);
    expect(JSON.stringify(after)).not.toContain(LEARNER);
  });

  it("holds a passage back while a wrong answer keeps the learner on its scene", async () => {
    const { host, sid } = await hostWithLesson();
    await host.respond(sid, { kind: "ack" });
    const transition = await answerQuiz(host, sid, "D'un contrat entre individus");
    const record = host.conceptMapRecord(sid)!;
    const quiz = sceneOfType(record.scenes, "quiz");
    expect(host.currentPresentation(sid).scene.id).toBe(quiz.scene_id);   // the same item again
    expect(["replay", "remediate"]).toContain(transition.kind);     // a retry, or the prerequisite gate's way back
    expect(quiz).toMatchObject({ served: true, passages_released: false });
    expect(quiz.sources[0]!.quote).toBeUndefined();
    expect(record.path.at(-1)).toMatchObject({ correct: false, assessed_by: "key" });
  });

  it("writes the export under the library, and forget reports it as kept", async () => {
    const { host, root, sid } = await hostWithLesson();
    await host.respond(sid, { kind: "ack" });
    const exported = (await host.exportConceptMap(sid))!;
    const dir = join(root, "_exports", "concept-maps");
    expect(readdirSync(dir)).toHaveLength(1);
    expect(exported.saved_to).toBe(join(dir, readdirSync(dir)[0]!));
    const bytes = readFileSync(exported.saved_to!);
    expect(exported.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(JSON.parse(bytes.toString("utf-8"))).toEqual(exported.record);
    expect(exported.display_markdown).toContain(exported.saved_to!);
    expect((await host.exportConceptMap(sid))!.saved_to).not.toBe(exported.saved_to);   // never overwritten

    const report = await host.forget(sid);
    expect(report.kept).toContainEqual({ kind: "map_exports", path: join(root, "_exports") });
    expect(report.display_markdown).toContain("cartes de notions");
    expect(existsSync(exported.saved_to!)).toBe(true);
  });

  it("returns the record without a file when the host has no library", async () => {
    const { host, sid, root } = await hostWithLesson({ library: false });
    const exported = (await host.exportConceptMap(sid))!;
    expect(exported).toMatchObject({ saved_to: null, sha256: null });
    expect(exported.record.schema).toBe(CONCEPT_MAP_RECORD_SCHEMA);
    expect(existsSync(join(root, "_exports"))).toBe(false);
  });
});
