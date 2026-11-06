// The prompts of a live session (INT-STUDIUM-058 § 2.6): the host reads the moment (first screen, a
// pause, the end of the lesson), puts the triggers' proposals to the session's book and keeps what
// became of each. Learners here are labelled synthetic ones (test-only key reads).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";
import { PromptRefusedError } from "./prompts.js";

const T0 = Date.parse("2026-11-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "host-prompts-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, concept: string) => ({ id, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [] });
const concept = (id: string, c: string) => ({ ...base(id, c), type: "concept", markdown: "Le cours." });
const quiz = (id: string, c: string) => ({
  ...base(id, c), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const lesson = (scenes: object[]) => ({
  schema_version: "1.4", bundle_id: "lesson-p", source_plan_id: "p",
  metadata: { title: "Leçon P", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
  concepts: ["c-un", "c-deux"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
  scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
});
function library(bundle: object): string {
  const root = tmp();
  writeFileSync(join(root, "P.json"), JSON.stringify(bundle));
  return root;
}
async function open(bundle: object) {
  const host = new SessionHost({ bundlesRoot: library(bundle), live: false, dataDir: null, clock: { now: () => new Date(T0).toISOString() } });
  return { host, sid: (await host.create("P.json", "auto-test-prompts")).sessionId };
}
function choice(host: SessionHost, sid: string, text: string): string {
  const scene = host.currentPresentation(sid).scene as { choices?: { id: string; text: string }[] };
  return scene.choices!.find((c) => c.text === text)!.id;
}
const ASK = { locale: "fr" as const };

describe("the prompts of a session", () => {
  it("proposes nothing on an ordinary lesson played on a panel", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux")]));
    expect(host.sessionPrompts(sid, ASK)).toEqual([]);
    await host.respond(sid, { kind: "ack" });
    expect(host.sessionPrompts(sid, ASK)).toEqual([]);
    expect(host.promptRecords(sid)).toEqual([]);
  });

  it("proposes the reviews due on the first screen of a lesson taken up again, once, and counts it ignored when the scene goes by", async () => {
    const root = library(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux"), concept("s-c3", "c-deux")]));
    const data = tmp();
    let now = T0;
    const start = async () => {
      const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: data, clock: { now: () => new Date(now).toISOString() } });
      return { host, sid: (await host.create("P.json", "auto-test-prompts")).sessionId };
    };
    const first = await start();
    await first.host.respond(first.sid, { kind: "ack" });
    await first.host.respond(first.sid, { kind: "quiz_choice", choiceId: choice(first.host, first.sid, "Juste"), confidence: 2 });
    expect(first.host.sessionPrompts(first.sid, ASK)).toEqual([]);          // nothing is due the same day
    await first.host.close(first.sid);

    now = T0 + 400 * DAY;                                                   // the learner comes back much later
    const { host, sid } = await start();
    const due = { id: "review_due:start", kind: "review_due", reason: "1 notion à revoir aujourd'hui", expires: "scene" };
    expect(host.sessionPrompts(sid, ASK)).toEqual([due]);
    expect(host.sessionPrompts(sid, ASK)).toEqual([due]);                   // still open, made once
    expect(host.sessionPrompts(sid, { locale: "en" })).toEqual([due]);      // an open prompt keeps its words
    await host.respond(sid, { kind: "ack" });
    expect(host.sessionPrompts(sid, ASK)).toEqual([]);
    expect(host.promptRecords(sid)).toEqual([{ id: "review_due:start", kind: "review_due", scene_id: "s-c2", outcome: "ignored" }]);
  }, 20_000);

  it("offers forms once when the lesson is played in the conversation, at a pause and never over a question", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux"), concept("s-c3", "c-deux")]));
    await host.respond(sid, { kind: "ack" });                              // now on the question
    const inText = { ...ASK, surfaceRank: 1 as const, formsAvailable: true };
    expect(host.sessionPrompts(sid, inText)).toEqual([]);                  // an answer is owed
    await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    const offered = host.sessionPrompts(sid, inText);
    expect(offered.map((p) => [p.id, p.kind, p.expires])).toEqual([["forms_offer", "forms_offer", "session"]]);
    expect(host.settlePrompt(sid, "forms_offer", "dismissed")).toEqual({ id: "forms_offer", kind: "forms_offer", scene_id: "s-c2", outcome: "dismissed" });
    await host.respond(sid, { kind: "ack" });
    expect(host.sessionPrompts(sid, inText)).toEqual([]);                  // not offered again
    expect(() => host.settlePrompt(sid, "forms_offer", "accepted")).toThrow(PromptRefusedError);
    // A client that cannot show forms, or a lesson already on a richer surface, is offered none.
    const other = await open(lesson([concept("s-c", "c-un"), concept("s-c2", "c-deux")]));
    expect(other.host.sessionPrompts(other.sid, { ...ASK, surfaceRank: 1, formsAvailable: false })).toEqual([]);
    expect(other.host.sessionPrompts(other.sid, { ...ASK, surfaceRank: 2, formsAvailable: true })).toEqual([]);
  });

  it("offers the map when a lesson with a map ends, and keeps the answer", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un"), concept("s-c2", "c-deux")]));
    await host.respond(sid, { kind: "ack" });
    const end = await host.respond(sid, { kind: "ack" });
    expect(end.kind).toBe("complete");
    expect(host.sessionPrompts(sid, ASK).map((p) => p.id)).toEqual(["map_offer"]);
    expect(host.settlePrompt(sid, "map_offer", "accepted")).toMatchObject({ kind: "map_offer", scene_id: null, outcome: "accepted" });
    expect(host.sessionPrompts(sid, ASK)).toEqual([]);
    expect(host.promptRecords(sid)).toEqual([{ id: "map_offer", kind: "map_offer", scene_id: null, outcome: "accepted" }]);
  });

  it("says a proposal once in the conversation text, at a pause, and never over a question", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un"), concept("s-c2", "c-un"), quiz("s-q", "c-un"), concept("s-c3", "c-deux")]));
    const inText = { ...ASK, surfaceRank: 1 as const, formsAvailable: true };
    const text = () => host.currentPresentation(sid).display_markdown as string;
    expect(text()).not.toContain("Proposition");                          // nothing was proposed yet
    expect(host.sessionPrompts(sid, inText).map((p) => p.id)).toEqual(["forms_offer"]);
    const first = text();
    expect(first).toContain("> **Proposition\u00a0:** Cette leçon peut se jouer en formulaires");
    expect(first.indexOf("**Proposition\u00a0:**")).toBeLessThan(first.lastIndexOf("`Leçon P"));   // before the status line
    // Said once: the next screens do not repeat it, though it stays open to an answer.
    expect(text()).not.toContain("Proposition");
    const second = await host.respond(sid, { kind: "ack" });
    expect(second.display_markdown).not.toContain("Proposition");
    expect(host.sessionPrompts(sid, inText).map((p) => p.id)).toEqual(["forms_offer"]);
    // A proposal made while a question waits is not said over it: it is said at the next pause.
    const other = await open(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c3", "c-deux"), concept("s-c4", "c-deux")]));
    const onQuestion = await other.host.respond(other.sid, { kind: "ack" });
    expect(other.host.sessionPrompts(other.sid, inText)).toEqual([]);
    expect(onQuestion.display_markdown).not.toContain("Proposition");
    const answered = await other.host.respond(other.sid, { kind: "quiz_choice", choiceId: choice(other.host, other.sid, "Juste"), confidence: 2 });
    expect(answered.display_markdown).not.toContain("Proposition");       // the book is asked by the surface, after the answer
    expect(other.host.sessionPrompts(other.sid, inText).map((p) => p.id)).toEqual(["forms_offer"]);
    expect(other.host.currentPresentation(other.sid).display_markdown).toContain("> **Proposition\u00a0:**");
    // A proposal made on a reading screen and not said yet waits while the next screen asks a question.
    const held = await open(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c3", "c-deux"), concept("s-c4", "c-deux")]));
    expect(held.host.sessionPrompts(held.sid, inText).map((p) => p.id)).toEqual(["forms_offer"]);
    const question = await held.host.respond(held.sid, { kind: "ack" });
    expect(question.display_markdown).toContain("Question ?");
    expect(question.display_markdown).not.toContain("Proposition");
    const after = await held.host.respond(held.sid, { kind: "quiz_choice", choiceId: choice(held.host, held.sid, "Juste"), confidence: 2 });
    expect(after.display_markdown).toContain("> **Proposition\u00a0:** Cette leçon peut se jouer en formulaires");
  });

  it("proposes nothing in quiet mode, and follows the level the learner sets", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un"), concept("s-c2", "c-deux"), concept("s-c3", "c-deux")]));
    const inText = { ...ASK, surfaceRank: 1 as const, formsAvailable: true };
    expect(host.sessionPrompts(sid, { ...inText, attention: "quiet" })).toEqual([]);
    expect(host.sessionPrompts(sid, { ...inText, attention: "normal" }).map((p) => p.id)).toEqual(["forms_offer"]);
  });
});
