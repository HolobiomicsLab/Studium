// The prompts of a lesson played in the conversation or in forms (INT-STUDIUM-058 § 2.6, task 5.2's
// recorded deviation): a call that names its surface (`promptSurface`, rank 1 or 2) has the host feed
// the session's book when it builds the screen, so the proposals of that moment are said in the text
// it returns, next to a resume notice. Without it nothing changes: the book is fed by the surface that
// asks (sessionPrompts). Learners here are labelled synthetic ones.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

const T0 = Date.parse("2026-11-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "host-prompt-surface-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, concept: string) => ({ id, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 60, adaptation_hooks: [] });
const concept = (id: string, c: string) => ({ ...base(id, c), type: "concept", markdown: "Le cours." });
const quiz = (id: string, c: string) => ({
  ...base(id, c), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const explain = (id: string, c: string) => ({
  ...base(id, c), type: "explain_back", prompt: "Explique.",
  key_points: [{ id: "kp", text: "Le signe suit la phase.", cues: ["signe"] }], model_explanation: "Modèle.",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
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
function choice(host: SessionHost, sid: string, text: string): string {
  const scene = host.currentPresentation(sid).scene as { choices?: { id: string; text: string }[] };
  return scene.choices!.find((c) => c.text === text)!.id;
}
const CONVERSATION = { rank: 1 as const, formsAvailable: false };
const REVIEW = "> **Proposition :** 1 notion à revoir aujourd'hui (proposition `review_due:start`)";
const RESUMED = "> Reprise à l'étape 3 sur 4.";

/** A learner who answered a graded question at T0 and comes back 400 days later, on a screen to read. */
async function comingBack() {
  const root = library(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux"), concept("s-c3", "c-deux")]));
  const data = tmp();
  let now = T0;
  const host = () => new SessionHost({ bundlesRoot: root, live: false, dataDir: data, clock: { now: () => new Date(now).toISOString() } });
  const first = host();
  const { sessionId } = await first.create("P.json", "auto-test-prompt-surface");
  await first.respond(sessionId, { kind: "ack" });
  await first.respond(sessionId, { kind: "quiz_choice", choiceId: choice(first, sessionId, "Juste"), confidence: 2 });
  await first.close(sessionId);
  now = T0 + 400 * DAY;
  return host();
}

describe("the prompts of a lesson played in the conversation or in forms", () => {
  it("says the review due on the first screen of a lesson started in the conversation, next to the resume notice", async () => {
    const host = await comingBack();
    const started = await host.create("P.json", "auto-test-prompt-surface", { promptSurface: CONVERSATION });
    const text = started.presentation.display_markdown as string;
    expect(text).toContain(RESUMED);
    expect(text).toContain(`${REVIEW}\n> _Tu peux accepter, ou dire «\u00a0plus tard\u00a0»._`);
    expect(text.indexOf(RESUMED)).toBeLessThan(text.indexOf(REVIEW));
    expect(host.currentPresentation(started.sessionId, { promptSurface: CONVERSATION }).display_markdown).not.toContain("Proposition");   // said once
    expect(host.sessionPrompts(started.sessionId, { locale: "fr" }).map((p) => p.id)).toEqual(["resume_notice:s-c2", "review_due:start"]);
  });

  it("changes nothing for a call that names no surface: the book waits for the surface that asks", async () => {
    const host = await comingBack();
    const started = await host.create("P.json", "auto-test-prompt-surface");
    expect(started.presentation.display_markdown).toContain(RESUMED);
    expect(started.presentation.display_markdown).not.toContain("Proposition");
    expect(host.currentPresentation(started.sessionId).display_markdown).not.toContain("Proposition");
    expect(host.sessionPrompts(started.sessionId, { locale: "fr" }).map((p) => p.id)).toEqual(["resume_notice:s-c2", "review_due:start"]);
  });

  it("offers forms in the conversation at the first pause, and the map at the end of the lesson", async () => {
    const host = new SessionHost({ bundlesRoot: library(lesson([concept("s-c", "c-un"), quiz("s-q", "c-un"), concept("s-c2", "c-deux")])), live: false, dataDir: null });
    const withForms = { rank: 1 as const, formsAvailable: true };
    const { sessionId, presentation } = await host.create("P.json", "auto-test-prompt-surface", { promptSurface: withForms });
    expect(presentation.display_markdown).toContain("> **Proposition :** Cette leçon peut se jouer en formulaires");
    expect(presentation.display_markdown).toContain("(proposition `forms_offer`)");
    const question = await host.respond(sessionId, { kind: "ack" }, "companion", { promptSurface: withForms });
    expect(question.display_markdown).not.toContain("Proposition");
    await host.respond(sessionId, { kind: "quiz_choice", choiceId: choice(host, sessionId, "Juste"), confidence: 2 }, "companion", { promptSurface: withForms });
    const end = await host.respond(sessionId, { kind: "ack" }, "companion", { promptSurface: withForms });
    expect(end.kind).toBe("complete");
    expect(end.display_markdown).toContain("> **Proposition :** Leçon terminée");
    expect(end.display_markdown).toContain("(proposition `map_offer`)");
  });

  it("says in forms what is proposed at a pause, without offering forms again", async () => {
    const host = new SessionHost({ bundlesRoot: library(lesson([concept("s-c", "c-un"), concept("s-c2", "c-deux")])), live: false, dataDir: null });
    const forms = { rank: 2 as const, formsAvailable: true };
    const { sessionId } = await host.create("P.json", "auto-test-prompt-surface");
    expect(host.currentPresentation(sessionId, { promptSurface: forms }).display_markdown).not.toContain("Proposition");
    const next = await host.respond(sessionId, { kind: "ack" }, "fast", { promptSurface: forms });
    expect(next.display_markdown).not.toContain("Proposition");
    const end = await host.respond(sessionId, { kind: "ack" }, "fast", { promptSurface: forms });
    expect(end.kind).toBe("complete");
    expect(end.display_markdown).toContain("> **Proposition :** Leçon terminée");
  });

  it("says after a self-rating what the rating held back", async () => {
    const host = new SessionHost({ bundlesRoot: library(lesson([explain("s-e", "c-un"), concept("s-c", "c-deux"), concept("s-c2", "c-deux")])), live: false, dataDir: null });
    const withForms = { rank: 1 as const, formsAvailable: true };
    const { sessionId, presentation } = await host.create("P.json", "auto-test-prompt-surface", { promptSurface: withForms });
    expect(presentation.display_markdown).not.toContain("Proposition");                       // an answer is owed
    const answered = await host.respond(sessionId, { kind: "reply", text: "Le signe suit la phase." }, "companion", { promptSurface: withForms });
    expect(answered.self_rating).toBeDefined();
    expect(answered.display_markdown).not.toContain("Proposition");                           // a self-rating is owed
    const rated = await host.rateRecall(sessionId, "s-e", "good", "companion", { promptSurface: withForms });
    expect(rated.display_markdown).toContain("> **Proposition :** Cette leçon peut se jouer en formulaires");
  });
});
