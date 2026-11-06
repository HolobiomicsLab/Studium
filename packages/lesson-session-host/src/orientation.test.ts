// packages/lesson-session-host/src/orientation.test.ts
//
// INT-STUDIUM-058, lot 1, task 1.1 — where the learner is, at any moment and on any surface: the step
// out of the total, the concept on screen, the minutes left, the reviews due, what is expected of them
// and why the lesson last adapted; and the same as one status line of at most 80 characters. It is
// computed from the public side of the session: no answer key, hint or reveal may appear in it.
// Learners here are labelled synthetic ones (test-only key reads).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SessionHost } from "./host.js";
import { operatorContext } from "./operator-context.js";
import { createHash } from "node:crypto";
import { helpOf, orientationOf, statusLine, voicesOf, type Orientation } from "./orientation.js";

const T0 = Date.parse("2026-11-06T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SECRETS = ["RÉVÉLÉ", "INDICE-SECRET"];
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "orientation-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const base = (id: string, concept: string, seconds: number) => ({
  id, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: seconds, adaptation_hooks: [],
});
const concept = (id: string, c: string, seconds: number) => ({ ...base(id, c, seconds), type: "concept", markdown: "Le cours." });
const quiz = (id: string, c: string, seconds: number) => ({
  ...base(id, c, seconds), type: "quiz", question: "Question ?",
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "RÉVÉLÉ : oui", feedback_incorrect: "RÉVÉLÉ : non", hints: ["INDICE-SECRET un"],
});
const explainBack = (id: string, c: string, seconds: number) => ({
  ...base(id, c, seconds), type: "explain_back", prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "kp", text: "RÉVÉLÉ : le signe suit la phase.", cues: ["signe"] }], model_explanation: "RÉVÉLÉ : modèle.",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});
function lesson(scenes: object[], who: { authoring?: object; validated_by?: string } = {}) {
  return {
    schema_version: "1.4", bundle_id: "lesson-o", source_plan_id: "p",
    metadata: {
      title: "Leçon O", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie",
      ...(who.authoring ? { authoring: who.authoring } : {}),
    },
    concepts: ["c-un", "c-deux"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: who.validated_by ?? "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}
/** Concept, quiz, quiz: the lesson of the plan's task 1.1. */
const threeScenes = () => lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-un", 90), quiz("s-q2", "c-deux", 45)]);

/** Start a session on `bundle`. `approval` writes the reviewer's record next to the lesson: bound to
 * these exact bytes (`current`) or to an earlier version of the file (`stale`). */
async function open(bundle: object, approval?: "current" | "stale") {
  const root = tmp();
  mkdirSync(dirname(join(root, "O.json")), { recursive: true });
  const bytes = JSON.stringify(bundle);
  writeFileSync(join(root, "O.json"), bytes);
  if (approval) {
    writeFileSync(join(root, "approval.json"), JSON.stringify({
      schema: "studium-approval/1", reviewer: "Prof. Relu", reviewed_at: "2026-11-01T00:00:00Z",
      bundle_sha256: approval === "current" ? createHash("sha256").update(bytes).digest("hex") : "0".repeat(64),
    }));
  }
  const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null, clock: { now: () => new Date(T0).toISOString() } });
  const started = await host.create("O.json", "auto-test-orientation");
  return { host, sid: started.sessionId };
}
/** The displayed id of the choice whose text is `text` (choices are reshuffled per session). */
function choice(host: SessionHost, sid: string, text: string): string {
  const scene = host.currentPresentation(sid).scene as { choices?: { id: string; text: string }[] };
  return scene.choices!.find((c) => c.text === text)!.id;
}

describe("orientationOf — where the learner is", () => {
  it("gives the step, what is expected and the reviews due, and no answer content", async () => {
    const { host, sid } = await open(threeScenes());
    expect(orientationOf(host, sid)).toMatchObject({ step: { index: 1, total: 3 }, waiting: "read", reviews_due: 0 });

    await host.respond(sid, { kind: "ack" });
    const second = orientationOf(host, sid);
    expect(second).toMatchObject({ step: { index: 2, total: 3 }, waiting: "answer", reviews_due: 0 });
    for (const secret of SECRETS) expect(JSON.stringify(second)).not.toContain(secret);
  });

  it("names the concept on screen and the minutes left, rounded up", async () => {
    const { host, sid } = await open(threeScenes());
    expect(orientationOf(host, sid).minutes_left).toBe(4); // 60 s + 90 s + 45 s
    await host.respond(sid, { kind: "ack" });
    const second = orientationOf(host, sid);
    expect(second.concept).toEqual({ id: "c-un", title: "Notion c-un", state: "current" });
    expect(second.minutes_left).toBe(3); // 90 s + 45 s
  });

  it("gives no minutes when the lesson states no duration", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 0), quiz("s-q1", "c-deux", 0)]));
    expect(orientationOf(host, sid)).not.toHaveProperty("minutes_left");
  });

  it("says nothing of an adaptation after a plain advance", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    expect(orientationOf(host, sid)).not.toHaveProperty("last_adaptation");
    expect(orientationOf(host, sid).step).not.toHaveProperty("detour");
  });

  it("waits for the learner's own rating after a written answer nobody assessed, until they move on", async () => {
    const { host, sid } = await open(lesson([explainBack("s-e", "c-un", 30), quiz("s-q1", "c-deux", 30), quiz("s-q2", "c-deux", 30)]));
    const answered = await host.respond(sid, { kind: "reply", text: "Le signe change avec la phase." });
    expect(answered.self_rating).toMatchObject({ requested: true });
    const waiting = orientationOf(host, sid);
    expect(waiting.waiting).toBe("self_rating");
    for (const secret of SECRETS) expect(JSON.stringify(waiting)).not.toContain(secret);

    await host.rateRecall(sid, "s-e", "good");
    expect(orientationOf(host, sid).waiting).toBe("answer");
  });

  it("does not keep waiting for a rating the learner skipped", async () => {
    const { host, sid } = await open(lesson([explainBack("s-e", "c-un", 30), quiz("s-q1", "c-deux", 30), quiz("s-q2", "c-deux", 30)]));
    await host.respond(sid, { kind: "reply", text: "Le signe change avec la phase." });
    await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(orientationOf(host, sid)).toMatchObject({ step: { index: 3, total: 3 }, waiting: "answer" });
  });

  it("expects nothing once the lesson is complete", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60)]));
    await host.respond(sid, { kind: "ack" });
    const end = await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(end.kind).toBe("complete");
    const done = orientationOf(host, sid);
    expect(done).toMatchObject({ step: { index: 2, total: 2 }, waiting: "nothing" });
    expect(done).not.toHaveProperty("minutes_left");
    expect(done).not.toHaveProperty("concept");
  });

  it("counts the concepts of this lesson due for review at the given moment", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(orientationOf(host, sid).reviews_due).toBe(0);
    expect(orientationOf(host, sid, { nowMs: T0 + 400 * DAY }).reviews_due).toBe(1);
  });
});

describe("orientationOf — an adaptation, on fixtures/atomistique-l1", () => {
  const root = resolve(__dirname, "../../../fixtures");
  const ref = "atomistique-l1/lesson.json";
  const bundle = JSON.parse(readFileSync(`${root}/${ref}`, "utf8")) as {
    scenes: { id: string; choices?: { text: string; correct: boolean }[] }[];
  };
  const keyOf = (id: string) => bundle.scenes.find((s) => s.id === id)!.choices!.filter((c) => c.correct).map((c) => c.text);

  it("reports the prerequisite detour, why, and where it returns; then drops it at the return", async () => {
    const host = new SessionHost({ bundlesRoot: root, live: false });
    const sid = (await host.create(ref, "auto-test-orientation-detour")).sessionId;
    let detourSeen = false;
    let returned = false;
    for (let step = 0; step < 90 && !returned; step++) {
      const scene = host.currentPresentation(sid).scene as { id: string; type: string; choices?: { id: string; text: string }[] };
      const wrong = scene.id === "s2-quiz-4f" && !detourSeen;
      const key = scene.type === "quiz" ? keyOf(scene.id) : [];
      const input = scene.type === "quiz"
        ? { kind: "quiz_choice" as const, choiceId: scene.choices!.find((c) => key.includes(c.text) !== wrong)!.id, confidence: 2 }
        : operatorContext(host, sid).response.example;
      const transition = await host.respond(sid, input as never);
      if (transition.kind === "complete") break;
      const o = orientationOf(host, sid);
      if (wrong) {
        detourSeen = true;
        expect(transition.navigation).toMatchObject({ kind: "remediate" });
        expect(o.step.detour).toEqual({ returns_to: transition.navigation!.returns_to });
        expect(o.last_adaptation).toEqual({
          kind: "remediate", reason: transition.navigation!.reason,
          detail: { rule_id: transition.navigation!.rule_id, evidence: ["s2-quiz-4f"] },
        });
        expect(o.last_adaptation!.reason.length).toBeGreaterThan(0);
        expect(statusLine(o, "Atomistique", "fr")).toContain("détour");
      } else if (transition.concept_map?.moment === "detour_return") {
        returned = true;
        expect(o.step).not.toHaveProperty("detour");
      } else if (detourSeen) {
        expect(o.step.detour).toBeDefined();
      }
    }
    expect(detourSeen).toBe(true);
    expect(returned).toBe(true);
  });
});

describe("voicesOf — who wrote a screen, who assessed an answer", () => {
  const agentDrafted = { authoring: { mode: "self_study", drafted_by: "agent" }, validated_by: "SELF-STUDY (non validée)" };

  it("names the teacher who signs a validated lesson", async () => {
    const { host, sid } = await open(threeScenes());
    expect(voicesOf(host, sid)).toEqual({ scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } });
  });

  it("says a lesson an agent drafted was not reviewed, and names nobody", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60)], agentDrafted));
    expect(voicesOf(host, sid).scene).toEqual({ kind: "author", name: null, reviewed: false, drafted_by: "agent" });
  });

  it("says who drafted a self-study lesson the learner wrote", async () => {
    const who = { authoring: { mode: "self_study", author_is_learner: true }, validated_by: "SELF-STUDY (non validée)" };
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60)], who));
    expect(voicesOf(host, sid).scene).toEqual({ kind: "author", name: null, reviewed: false, drafted_by: "learner" });
  });

  it("names the reviewer whose approval is bound to this exact lesson file", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60)], agentDrafted), "current");
    expect(voicesOf(host, sid).scene).toEqual({ kind: "author", name: "Prof. Relu", reviewed: true, drafted_by: "agent" });
  });

  it("says a lesson changed since its approval is not reviewed, even one a teacher signed", async () => {
    const { host, sid } = await open(threeScenes(), "stale");
    expect(voicesOf(host, sid).scene).toEqual({ kind: "author", name: "Prof. Test", reviewed: false, drafted_by: "teacher" });
  });

  it("says the author's key assessed a quiz answer, a judge a judged one, and nobody an unassessed one", async () => {
    const { host, sid } = await open(threeScenes());
    const read = await host.respond(sid, { kind: "ack" });
    expect(voicesOf(host, sid, read.verdict)).not.toHaveProperty("verdict");
    const answered = await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(answered.verdict).toMatchObject({ assessed_by: "key" });
    expect(voicesOf(host, sid, answered.verdict).verdict).toEqual({ kind: "key" });
    expect(voicesOf(host, sid, { assessed_by: "judge" }).verdict).toEqual({ kind: "judge" });
    expect(voicesOf(host, sid, { assessed_by: "none" })).not.toHaveProperty("verdict");
  });
});

describe("helpOf — the help ladder: try first, then an explanation", () => {
  const rung = (host: SessionHost, sid: string, kind: string, locale: "fr" | "en" = "fr") =>
    helpOf(host, sid, locale).rungs.find((r) => r.kind === kind)!;

  it("on a quiz not tried yet: a hint with its cost, no explanation and no reference before an answer", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    const help = helpOf(host, sid, "fr");
    expect(help.rungs).toEqual([
      { kind: "reread", available: true },
      { kind: "hint", available: true, cost: "un indice réduit le crédit de cette réponse" },
      { kind: "explain", available: false, why_not: "essaie d'abord de répondre" },
      { kind: "reference", available: false, why_not: "la référence s'affiche après ta réponse" },
    ]);
    expect(helpOf(host, sid, "en").rungs).toEqual([
      { kind: "reread", available: true },
      { kind: "hint", available: true, cost: "a hint lowers the credit of this answer" },
      { kind: "explain", available: false, why_not: "try an answer first" },
      { kind: "reference", available: false, why_not: "the reference shows after your answer" },
    ]);
    for (const secret of SECRETS) expect(JSON.stringify(help)).not.toContain(secret);
  });

  it("on a screen to read: an explanation at once, and no hint", async () => {
    const { host, sid } = await open(threeScenes());
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
    expect(rung(host, sid, "hint")).toEqual({ kind: "hint", available: false, why_not: "pas d'indice pour cet écran" });
    expect(rung(host, sid, "reference")).toEqual({ kind: "reference", available: false, why_not: "pas de référence pour cet écran" });
  });

  it("has no hint left once the hints of this try are used", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    expect(host.requestHint(sid)).not.toBeNull();
    expect(host.requestHint(sid)).toBeNull();
    expect(rung(host, sid, "hint")).toEqual({ kind: "hint", available: false, why_not: "plus d'indice pour cet essai" });
    expect(rung(host, sid, "hint", "en")).toEqual({ kind: "hint", available: false, why_not: "no hint left for this try" });
  });

  it("while the learner rates their own answer: the reference to compare with, and an explanation", async () => {
    const { host, sid } = await open(lesson([explainBack("s-e", "c-un", 30), quiz("s-q1", "c-deux", 30), quiz("s-q2", "c-deux", 30)]));
    await host.respond(sid, { kind: "reply", text: "Le signe change avec la phase." });
    expect(orientationOf(host, sid).waiting).toBe("self_rating");
    expect(rung(host, sid, "reference")).toEqual({ kind: "reference", available: true });
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
  });

  it("explains after a first try on the same scene (fixtures/atomistique-l1, a replayed recall question)", async () => {
    const root = resolve(__dirname, "../../../fixtures");
    const ref = "atomistique-l1/lesson.json";
    const bundle = JSON.parse(readFileSync(`${root}/${ref}`, "utf8")) as {
      scenes: { id: string; choices?: { text: string; correct: boolean }[] }[];
    };
    const keyOf = (id: string) => bundle.scenes.find((s) => s.id === id)!.choices!.filter((c) => c.correct).map((c) => c.text);
    const host = new SessionHost({ bundlesRoot: root, live: false });
    const sid = (await host.create(ref, "auto-test-orientation-help")).sessionId;
    const current = () => host.currentPresentation(sid).scene as { id: string; type: string; choices?: { id: string; text: string }[] };
    const answer = (wrong: boolean) => {
      const scene = current();
      const key = scene.type === "quiz" ? keyOf(scene.id) : [];
      return host.respond(sid, (scene.type === "quiz"
        ? { kind: "quiz_choice", choiceId: scene.choices!.find((c) => key.includes(c.text) !== wrong)!.id, confidence: 2 }
        : operatorContext(host, sid).response.example) as never);
    };
    for (let step = 0; step < 40 && current().id !== "s2-quiz-4f"; step++) await answer(false);
    await answer(true); // wrong on s2-quiz-4f: a detour to a recall question
    expect(current().id).toBe("s9-rappel-3d");
    expect(rung(host, sid, "explain")).toMatchObject({ available: false });
    const replay = await answer(true); // wrong again: the same question is asked once more
    expect(replay.navigation).toMatchObject({ kind: "replay" });
    expect(current().id).toBe("s9-rappel-3d");
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
    expect(rung(host, sid, "hint")).toMatchObject({ available: true });
  });
});

describe("statusLine — the orientation in one line", () => {
  const second: Orientation = { step: { index: 2, total: 3 }, minutes_left: 3, reviews_due: 2, waiting: "answer" };

  it("names the lesson, the step, the minutes left, the reviews due and what is expected", () => {
    expect(statusLine(second, "Leçon O", "fr")).toBe("Leçon O · étape 2/3 · 3 min · 2 révisions dues · à toi de répondre");
    expect(statusLine(second, "Lesson O", "en")).toBe("Lesson O · step 2/3 · 3 min · 2 reviews due · your answer");
  });

  it("leaves out what there is nothing to say about", () => {
    expect(statusLine({ step: { index: 1, total: 3 }, reviews_due: 0, waiting: "read" }, "Leçon O", "fr")).toBe("Leçon O · étape 1/3 · à lire");
    expect(statusLine({ ...second, reviews_due: 1 }, "Leçon O", "fr")).toContain("1 révision due ·");
    expect(statusLine({ ...second, reviews_due: 1 }, "Lesson O", "en")).toContain("1 review due ·");
  });

  it("never exceeds 80 characters: a long title is cut, the step and what is expected stay", () => {
    const title = "Atomistique et liaison chimique : ".repeat(4).slice(0, 120);
    expect(title).toHaveLength(120);
    for (const locale of ["fr", "en"] as const) {
      const line = statusLine({ ...second, step: { index: 2, total: 3, detour: { returns_to: "s-q2" } } }, title, locale);
      expect(line.length).toBeLessThanOrEqual(80);
      expect(line).toContain(locale === "fr" ? "étape 2/3" : "step 2/3");
      expect(line).toContain(locale === "fr" ? "à toi de répondre" : "your answer");
      expect(line).toContain("…");
    }
  });

  it("drops the title when no room is left for a readable one", () => {
    const crowded: Orientation = {
      step: { index: 100, total: 100, detour: { returns_to: "s" } }, minutes_left: 999, reviews_due: 99, waiting: "self_rating",
    };
    const line = statusLine(crowded, "Atomistique", "fr");
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line.startsWith("étape 100/100")).toBe(true);
  });
});
