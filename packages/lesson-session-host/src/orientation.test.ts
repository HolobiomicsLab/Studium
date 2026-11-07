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
import { helpOf, orientationOf, statusLine, voiceLine, voicesOf, VOICE_LINE_MAX, type Orientation, type Voice } from "./orientation.js";

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

describe("orientationOf — a contest's check questions, on fixtures/atomistique-l1", () => {
  const root = resolve(__dirname, "../../../fixtures");
  const ref = "atomistique-l1/lesson.json";
  const bundle = JSON.parse(readFileSync(`${root}/${ref}`, "utf8")) as {
    metadata: { title: string }; scenes: { id: string; choices?: { text: string; correct: boolean }[] }[];
  };

  it("says « contrôle n/total » while a check question is on screen, and the step again once the lesson resumes", async () => {
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: null });
    const sid = (await host.create(ref, "auto-test-orientation-contest")).sessionId;
    const answerRight = () => {
      const shown = host.currentPresentation(sid).scene as unknown as { id: string; choices: { id: string; text: string }[] };
      const key = bundle.scenes.find((s) => s.id === shown.id)!.choices!.find((c) => c.correct)!.text;
      return host.respond(sid, { kind: "quiz_choice", choiceId: shown.choices.find((c) => c.text === key)!.id, confidence: 2 });
    };
    await host.respond(sid, { kind: "ack" });   // past the intro: c-particules is now shown, so it takes a claim
    const before = orientationOf(host, sid);
    expect(before).not.toHaveProperty("contest");

    const started = await host.contest(sid, "c-particules", "known");
    expect(started.questions).toBe(2);
    expect(orientationOf(host, sid).contest).toEqual({ concept_id: "c-particules", question: 1, total: 2 });
    expect(started.presentation.display_markdown).toMatch(/· contrôle 1\/2 · [^`]*`$/);
    expect(started.presentation.display_markdown).not.toMatch(/`[^`]*étape \d+\/\d+[^`]*`$/);

    const first = await answerRight();
    expect(orientationOf(host, sid).contest).toEqual({ concept_id: "c-particules", question: 2, total: 2 });
    expect(first.kind === "next" && first.presentation.display_markdown).toMatch(/· contrôle 2\/2 · [^`]*`$/);
    expect(statusLine(orientationOf(host, sid), bundle.metadata.title, "en")).toContain("check 2/2");

    const second = await answerRight();
    expect(second.contest).toMatchObject({ outcome: "confirmed" });
    const after = orientationOf(host, sid);
    expect(after).not.toHaveProperty("contest");
    expect(after.step).toEqual(before.step);
    expect(second.kind === "next" && second.presentation.display_markdown).toMatch(new RegExp(`· étape ${before.step.index}/${before.step.total} · [^\`]*\`$`));
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

  it("explains the answer just missed on the screen that follows it, until the learner does something else", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    const missed = await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Faux"), confidence: 2 });
    expect(missed.verdict).toMatchObject({ scene_id: "s-q1", correct: false });
    expect(host.currentPresentation(sid).scene.id).toBe("s-q2");
    expect(host.orientationFacts(sid)).toMatchObject({ tried: false, answered_before: true });
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
    // A hint is an act of its own: the screen is no longer the first after the answer.
    expect(host.requestHint(sid)).not.toBeNull();
    expect(host.orientationFacts(sid).answered_before).toBe(false);
    expect(rung(host, sid, "explain")).toMatchObject({ available: false });
  });

  it("keeps the explanation closed after a read when the new screen awaits an answer not tried yet", async () => {
    const { host, sid } = await open(threeScenes());
    expect(host.orientationFacts(sid).answered_before).toBe(false);
    await host.respond(sid, { kind: "ack" });
    expect(host.orientationFacts(sid)).toMatchObject({ tried: false, answered_before: false });
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: false, why_not: "essaie d'abord de répondre" });
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
    // Test decision (walkthrough 2026-11-07): right after the missed answer the explanation is open
    // (answered_before); a hint is an act of its own, after which this question, not tried yet, waits.
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
    expect(host.requestHint(sid)).not.toBeNull();
    expect(rung(host, sid, "explain")).toMatchObject({ available: false });
    const replay = await answer(true); // wrong again: the same question is asked once more
    expect(replay.navigation).toMatchObject({ kind: "replay" });
    expect(current().id).toBe("s9-rappel-3d");
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
    expect(rung(host, sid, "hint")).toMatchObject({ available: true });
    // The first try alone keeps it open, after another hint too.
    expect(host.requestHint(sid)).not.toBeNull();
    expect(rung(host, sid, "explain")).toEqual({ kind: "explain", available: true });
  });
});

describe("voiceLine — the lesson's voice in one line", () => {
  const author = (over: Partial<Extract<Voice, { kind: "author" }>> = {}): Voice =>
    ({ kind: "author", name: null, reviewed: false, drafted_by: "teacher", ...over });

  it("says who drafted the lesson and whether a teacher read this version of it", () => {
    expect(voiceLine(author({ name: "Prof. Test", reviewed: true }), "fr")).toBe("Leçon validée par Prof. Test.");
    expect(voiceLine(author({ reviewed: true }), "fr")).toBe("Leçon validée par un enseignant.");
    expect(voiceLine(author({ name: "Prof. Test" }), "fr")).toBe("Leçon modifiée depuis sa validation par Prof. Test.");
    expect(voiceLine(author({ drafted_by: "agent" }), "fr")).toBe("Leçon rédigée par l'IA, non relue par un enseignant.");
    expect(voiceLine(author({ drafted_by: "agent", name: "Mme Durand", reviewed: true }), "fr")).toBe("Leçon rédigée par l'IA, validée par Mme Durand.");
    expect(voiceLine(author({ drafted_by: "learner" }), "fr")).toBe("Leçon que tu as rédigée, non relue par un enseignant.");
    expect(voiceLine(author({ drafted_by: "agent" }), "en")).toBe("AI-drafted lesson, not reviewed by a teacher.");
    expect(voiceLine(author({ name: "Dr Lee", reviewed: true }), "en")).toBe("Lesson validated by Dr Lee.");
    expect(voiceLine(author({ name: "Dr Lee" }), "en")).toBe("Lesson changed since Dr Lee validated it.");
    expect(voiceLine(author({ drafted_by: "learner", reviewed: true }), "en")).toBe("Lesson you wrote, validated by a teacher.");
  });

  it("stays within its length: a long name is cut", () => {
    const long = Array.from({ length: 20 }, () => "Professeure").join(" ");
    for (const locale of ["fr", "en"] as const) {
      for (const reviewed of [true, false]) {
        const line = voiceLine(author({ name: long, reviewed, drafted_by: "agent" }), locale);
        expect(line.length).toBeLessThanOrEqual(VOICE_LINE_MAX);
        expect(line).toContain("Professeure");
        expect(line).toContain("…");
      }
    }
  });

  it("is empty for a voice that is not the lesson's author", () => {
    expect(voiceLine({ kind: "key" }, "fr")).toBe("");
    expect(voiceLine({ kind: "judge" }, "en")).toBe("");
  });
});

describe("the conversation text carries the orientation and the voices (task 1.5)", () => {
  const agentDrafted = { authoring: { mode: "self_study", drafted_by: "agent" }, validated_by: "SELF-STUDY (non validée)" };

  it("ends every screen with the status line of that screen, on each way the host serves it", async () => {
    const { host, sid } = await open(threeScenes());
    expect(host.currentPresentation(sid).display_markdown.endsWith("`Leçon O · étape 1/3 · 4 min · à lire`")).toBe(true);
    const next = await host.respond(sid, { kind: "ack" });
    const second = "`Leçon O · étape 2/3 · 3 min · à toi de répondre`";
    expect(next.display_markdown.endsWith(second)).toBe(true);
    expect(next.kind === "next" && next.presentation.display_markdown.endsWith(second)).toBe(true);
    expect(host.currentPresentation(sid).display_markdown.endsWith(second)).toBe(true);
    for (const secret of SECRETS) expect(next.display_markdown).not.toContain(secret);
  });

  it("names who validated a teacher's lesson on the first screen only", async () => {
    const { host, sid } = await open(threeScenes());
    expect(host.currentPresentation(sid).display_markdown).toContain("> Leçon validée par Prof. Test.");
    const next = await host.respond(sid, { kind: "ack" });
    expect(next.display_markdown).not.toContain("Leçon validée par");
  });

  it("opens every later screen of an unreviewed agent-drafted lesson with its voice; the first has the notice", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60), quiz("s-q2", "c-deux", 60)], agentDrafted));
    const voice = "> Leçon rédigée par l'IA, non relue par un enseignant.";
    const first = host.currentPresentation(sid).display_markdown;
    expect(first.startsWith("> Leçon rédigée par l'IA à partir de tes sources")).toBe(true);
    expect(first).not.toContain(voice);
    const next = await host.respond(sid, { kind: "ack" });
    expect(next.kind === "next" && next.presentation.display_markdown.startsWith(`${voice}\n\n### `)).toBe(true);
    const third = await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(third.kind === "next" && third.presentation.display_markdown.startsWith(`${voice}\n\n### `)).toBe(true);
  });

  it("says the author's key assessed a quiz answer of a teacher's lesson", async () => {
    const { host, sid } = await open(threeScenes());
    await host.respond(sid, { kind: "ack" });
    const answered = await host.respond(sid, { kind: "quiz_choice", choiceId: choice(host, sid, "Juste"), confidence: 2 });
    expect(answered.verdict?.display_markdown).toContain("Évalué par la clé de l'auteur.");
  });

  it("a review mixes lessons: its screens carry the status line, and no person's name as the lesson's voice", async () => {
    const root = tmp();
    writeFileSync(join(root, "O.json"), JSON.stringify(lesson([quiz("s-q1", "c-un", 60)])));
    let now = T0;
    const host = new SessionHost({ bundlesRoot: root, live: false, dataDir: tmp(), clock: { now: () => new Date(now).toISOString() } });
    const learner = "auto-test-orientation-review";
    const started = await host.create("O.json", learner);
    const done = await host.respond(started.sessionId, { kind: "quiz_choice", choiceId: choice(host, started.sessionId, "Juste"), confidence: 2 });
    expect(done.kind).toBe("complete");
    // A finished lesson has no screen, so no status line.
    expect(done.display_markdown).not.toMatch(/`[^`]*étape[^`]*`/);
    now = T0 + 30 * DAY;
    const review = await host.startReview(learner);
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    const text = review.presentation.display_markdown;
    expect(text).toMatch(/`Séance de révision · étape 1\/1 · 1 min · [^`]*à toi de répondre`$/);
    // The review's own `validated_by` is a placeholder, not a person: it is never shown as a name.
    expect(text).not.toContain("review of teacher-validated lessons");
    expect(text).not.toContain("validée par");
    expect(host.authorVoice(review.sessionId)).toEqual({ kind: "author", name: null, reviewed: true, drafted_by: "teacher" });
  });

  it("adds at most 200 characters to a screen", async () => {
    const { host, sid } = await open(lesson([concept("s-c", "c-un", 60), quiz("s-q1", "c-deux", 60)], agentDrafted));
    const next = await host.respond(sid, { kind: "ack" });
    if (next.kind !== "next") throw new Error("expected a next screen");
    const served = next.presentation.display_markdown;
    const body = served.slice(served.indexOf("### "), served.lastIndexOf("\n\n`"));
    expect(served.length - body.length).toBeLessThanOrEqual(200);
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

  it("cuts a long title at its last separator that fits, the same on screens whose facts differ in length", () => {
    const title = "Atomistique L1 — Chapitre 1 (atomes, orbitales, liaisons)";
    const short: Orientation = { step: { index: 4, total: 32 }, minutes_left: 9, reviews_due: 0, waiting: "read" };
    const long: Orientation = { step: { index: 16, total: 32 }, minutes_left: 45, reviews_due: 0, waiting: "answer" };
    const shown = (o: Orientation) => {
      const line = statusLine(o, title, "fr");
      expect(line.length).toBeLessThanOrEqual(80);
      return line.slice(0, line.indexOf(" · étape"));
    };
    expect(shown(short)).toBe("Atomistique L1 — Chapitre 1");
    expect(shown(long)).toBe(shown(short));
    expect(shown(short)).not.toContain("…");
    // A title with a colon: the part before it.
    const colon = "Thermodynamique : premier et second principes, entropie et enthalpie libre";
    expect(statusLine(short, colon, "fr").startsWith("Thermodynamique · étape 4/32")).toBe(true);
  });

  it("falls back to a cut with an ellipsis when the title has no separator, and leaves a short title whole", () => {
    const plain = "Atomistique orbitales liaisons hybridation géométrie moléculaire et spectroscopie";
    const line = statusLine(second, plain, "fr");
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).toMatch(/^Atomistique[^·]*… · étape 2\/3/);
    const first: Orientation = { step: { index: 1, total: 3 }, reviews_due: 0, waiting: "read" };
    expect(statusLine(first, "Atomistique L1 — Chapitre 1", "fr")).toBe("Atomistique L1 — Chapitre 1 · étape 1/3 · à lire");
  });

  it("says when the screen is a check question of a contest, in place of the step", () => {
    const check: Orientation = { ...second, contest: { concept_id: "c-un", question: 1, total: 2 } };
    expect(statusLine(check, "Leçon O", "fr")).toBe("Leçon O · contrôle 1/2 · 3 min · 2 révisions dues · à toi de répondre");
    expect(statusLine(check, "Lesson O", "en")).toBe("Lesson O · check 1/2 · 3 min · 2 reviews due · your answer");
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
