// packages/lesson-session-host/src/chat-display.test.ts
//
// HJ-4 / R3: every presentation and transition carries a localized display_markdown a chat client
// shows as is. It is built from the public projection only, so no answer key reaches it before the
// answer; it never prints a mastery number, a rule id or an internal reason code.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { presentationMarkdown, transitionMarkdown, verdictMarkdown, referenceMarkdown, recallRatedMarkdown, formatReviewDate } from "./chat-display.js";
import { REDACTED_SCENE_FIELDS } from "./public-scene.js";

const ATOMISTIQUE = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../fixtures/atomistique-l1/lesson.json", import.meta.url)), "utf8",
)) as LessonBundle;

function presentation(scene: unknown, index = 0, extra: Record<string, unknown> = {}) {
  return {
    scene, index, total: ATOMISTIQUE.scenes.length, lastDecision: null, explanation: null,
    learnerSnapshot: { conceptMastery: { "c-particules": 0.7142857 }, scenesCompleted: index }, locale: "fr",
    authoring: { mode: "teacher", author_is_learner: false, validated: true, judge: false, notice: null,
      approval: { recorded: false, matches: false } },
    ...extra,
  } as never;
}

/** Every string under the answer-bearing fields of a full scene, long enough to be telling. */
function answerStrings(scene: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") { if (v.trim().length >= 12) out.push(v.trim()); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const field of REDACTED_SCENE_FIELDS) {
    // A verdict deck shows each claim's text, unlabelled, by design: there the key is the labels and
    // the expected flaws, not the texts.
    if (scene["verdict_deck"] && (field === "claims" || field === "sound_claims")) {
      for (const claim of (scene[field] as Array<Record<string, unknown>> | undefined) ?? []) walk(claim["flaws_expected"]);
      continue;
    }
    walk(scene[field]);
  }
  return out;
}

describe("presentationMarkdown", () => {
  it("never carries an answer key, for every scene of the real atomistique lesson", () => {
    for (const [index, scene] of ATOMISTIQUE.scenes.entries()) {
      const md = presentationMarkdown(presentation(scene, index));
      for (const secret of answerStrings(scene as never)) expect(md, `${scene.id} leaks: ${secret}`).not.toContain(secret);
      expect(md).not.toMatch(/\bcorrect\b/i);
      expect(md).not.toMatch(/0\.\d{3}/); // no mastery float
      expect(md).toContain(scene.title);
    }
  });

  it("states the title, the progress in words and how to reply (displayed quiz ids)", () => {
    const quiz = ATOMISTIQUE.scenes.find((s) => s.type === "quiz")!;
    const index = ATOMISTIQUE.scenes.indexOf(quiz);
    const md = presentationMarkdown(presentation(quiz, index));
    expect(md).toContain(`### ${quiz.title}`);
    expect(md).toContain(`Étape ${index + 1} sur ${ATOMISTIQUE.scenes.length}`);
    const ids = (quiz as { choices: Array<{ id: string }> }).choices.map((c) => c.id);
    expect(md).toContain(ids.join(", "));
    for (const c of (quiz as { choices: Array<{ text: string }> }).choices) expect(md).toContain(c.text);
  });

  it("shows the authoring notice on the first screen only, and warns when nothing is durable", () => {
    const notice = "Leçon rédigée par l'IA à partir de vos sources, non vérifiée par un enseignant.";
    const p = presentation(ATOMISTIQUE.scenes[0], 0, {
      authoring: { mode: "self_study", author_is_learner: false, validated: false, judge: false, notice,
        approval: { recorded: false, matches: false } },
    });
    expect(presentationMarkdown(p, { firstScreen: true })).toContain(notice);
    expect(presentationMarkdown(p)).not.toContain(notice);
    expect(presentationMarkdown(p, { firstScreen: true, notDurable: true })).toMatch(/redémarrage/);
    expect(presentationMarkdown(p, { firstScreen: true })).not.toMatch(/redémarrage/);
  });

  it("speaks English for an English lesson", () => {
    const scene = { ...ATOMISTIQUE.scenes[0], title: "Welcome" };
    const md = presentationMarkdown({ ...(presentation(scene) as object), locale: "en" } as never);
    expect(md).toContain("Step 1 of");
    expect(md).not.toContain("Étape");
  });
});

describe("transitionMarkdown", () => {
  const titleOf = (id: string) => ATOMISTIQUE.scenes.find((s) => s.id === id)?.title;
  const next = presentation(ATOMISTIQUE.scenes[3], 3);

  it("gives the verdict and feedback, then where the lesson goes, in words — never a rule id or code", () => {
    const t = {
      kind: "remediate", reason: "Prérequis à consolider d'abord.", presentation: next,
      verdict: { scene_id: "s2-quiz-4f", graded: true, signal: "answer_submitted", correct: false, feedback: "Non : l = 3." },
      navigation: { kind: "remediate", scene_id: "s1b-audit-particules", rule_id: "graph_prereq_gate",
        reason: "Prérequis à consolider d'abord.", modulator: "M6", returns_to: "s3-concept-orbitales" },
    } as never;
    const earned = verdictMarkdown(t, [], { sceneTitle: titleOf });
    const md = transitionMarkdown(t, { sceneTitle: titleOf });
    expect(earned).toMatch(/Pas tout à fait/);
    expect(earned).toContain("Non : l = 3.");
    expect(md).toContain("Prérequis à consolider d'abord.");
    expect(md).toContain(`« ${titleOf("s3-concept-orbitales")} »`);
    expect(md).toContain(ATOMISTIQUE.scenes[3]!.title); // the next scene follows the navigation
    for (const text of [earned, md]) expect(text).not.toMatch(/graph_prereq_gate|rule_|M6/);
    // Outside the verdict a transition is the next scene's public projection: no earned feedback there.
    expect(md).not.toContain("Non : l = 3.");
  });

  it("does not print a rule's internal reason code on a replay; uses its explanation in words", () => {
    const md = transitionMarkdown({
      kind: "replay", reason: "errors_threshold",
      presentation: { ...(next as object), explanation: { rule_id: "r-replay", explanation_short: "Deux erreurs : on revoit avec un appui.", modulator: "M1" } },
      verdict: { scene_id: "x", graded: true, signal: "answer_submitted", correct: false },
      navigation: { kind: "replay", scene_id: "x", rule_id: "r-replay", reason: "errors_threshold", modulator: "M1" },
    } as never, {});
    expect(md).not.toContain("errors_threshold");
    expect(md).not.toContain("r-replay");
    expect(md).toContain("Deux erreurs : on revoit avec un appui.");
  });

  it("an uncertified answer asks for a self-rating that never changes mastery, and cites the source", () => {
    const t = {
      kind: "next", presentation: next,
      verdict: { scene_id: "s3b-explain-2p", graded: true, signal: "answer_submitted", feedback: "Compare avec : …" },
      navigation: { kind: "advance", scene_id: "y", rule_id: null, reason: null, modulator: null },
      self_rating: { requested: true, scene_id: "s3b-explain-2p", grades: ["again", "hard", "good", "easy"] },
    } as never;
    const sources = [{ title: "Cours d'atomistique", quote: "La fonction d'onde change de signe.", url: "https://example.org/cours" }];
    const md = verdictMarkdown(t, sources);
    expect(md).toMatch(/Réponse enregistrée/);
    expect(md).toMatch(/again/);
    expect(md).toMatch(/easy/);
    expect(md).toMatch(/jamais ta maîtrise/);
    expect(md).toContain("« La fonction d'onde change de signe. »");
    expect(md).toContain("https://example.org/cours");
    const outside = transitionMarkdown(t);
    expect(outside).not.toContain("La fonction d'onde change de signe.");
    expect(outside).not.toMatch(/again/);
  });

  // I-1: the reference of a key-point or audit scene is data on the verdict; the chat lays it out under
  // its own headings, after the feedback and before the passages, so the self-rating request that follows
  // has the model answer in sight.
  it("lays out a verdict's key points and model answer under their own headings (I-1)", () => {
    const t = {
      kind: "next", presentation: next,
      verdict: { scene_id: "s3b-explain-2p", graded: true, signal: "answer_submitted",
        key_points: ["La fonction d'onde change de signe", "Un plan nodal sépare les lobes"],
        model_answer: "La fonction d'onde change de signe de part et d'autre d'un plan nodal.", reference_kind: "key_points" },
      navigation: { kind: "advance", scene_id: "y", rule_id: null, reason: null, modulator: null },
      self_rating: { requested: true, scene_id: "s3b-explain-2p", grades: ["again", "hard", "good", "easy"] },
    } as never;
    const sources = [{ title: "Cours d'atomistique", quote: "Le signe change au plan nodal." }];
    const md = verdictMarkdown(t, sources);
    expect(md).toContain([
      "**Compare ta réponse à ces points clés :**",
      "- La fonction d'onde change de signe\n- Un plan nodal sépare les lobes",
      "**Réponse modèle**",
      "La fonction d'onde change de signe de part et d'autre d'un plan nodal.",
    ].join("\n\n"));
    const at = (text: string) => md.indexOf(text);
    expect(at("Réponse enregistrée")).toBeLessThan(at("points clés"));
    expect(at("**Réponse modèle**")).toBeLessThan(at("Le signe change au plan nodal."));
    expect(at("Le signe change au plan nodal.")).toBeLessThan(at("again"));
    expect(transitionMarkdown(t)).not.toMatch(/points clés|plan nodal/);
  });

  it("labels an audit's reference as the planted flaws and the model correction, in English too (I-1)", () => {
    const verdict = { scene_id: "f", graded: true, signal: "answer_submitted", correct: true,
      key_points: ["2p holds four electrons"], model_answer: "N: 1s2 2s2 2p3.", reference_kind: "planted_flaws" };
    const fr = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "fr" });
    expect(fr).toContain("**Compare ton audit aux défauts plantés :**\n\n- 2p holds four electrons");
    expect(fr).toContain("**Correction modèle**\n\nN: 1s2 2s2 2p3.");
    const en = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "en" });
    expect(en).toContain("**Compare your audit with the planted flaws:**\n\n- 2p holds four electrons");
    expect(en).toContain("**Model correction**\n\nN: 1s2 2s2 2p3.");
    const keyPoints = verdictMarkdown({ kind: "complete", summary: {}, verdict: { ...verdict, reference_kind: "key_points" } } as never, [], { locale: "en" });
    expect(keyPoints).toContain("**Compare your answer with these key points:**\n\n- 2p holds four electrons");
    expect(keyPoints).toContain("**Model answer**\n\nN: 1s2 2s2 2p3.");
  });

  it("labels a critique's reference as the claims that hid a flaw, in French and English (T3)", () => {
    const verdict = { scene_id: "k", graded: true, signal: "answer_submitted",
      key_points: ["n=3 proves the effect (small sample)"], reference_kind: "flawed_claims" };
    const fr = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "fr" });
    expect(fr).toContain("**Compare ta critique aux affirmations qui cachaient un défaut :**\n\n- n=3 proves the effect (small sample)");
    const en = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "en" });
    expect(en).toContain("**Compare your critique with the claims that hid a flaw:**\n\n- n=3 proves the effect (small sample)");
    expect(en).not.toMatch(/planted flaws|key points/);
    expect(referenceMarkdown(verdict as never, "en").split("n=3 proves")).toHaveLength(2);
  });

  it("rate_recall's line gives the next review date and says mastery did not move", () => {
    const at = Date.UTC(2026, 10, 9, 9);
    expect(recallRatedMarkdown(at, "fr")).toContain(formatReviewDate(at, "fr"));
    expect(recallRatedMarkdown(at, "fr")).toMatch(/jamais ta maîtrise/);
    expect(recallRatedMarkdown(at, "en")).toMatch(/never changes your mastery/);
  });

  it("a completed lesson names what is consolidated and what to review, and the next review date", () => {
    const nextReview = Date.UTC(2026, 10, 6, 9);
    const md = transitionMarkdown({
      kind: "complete",
      summary: { totalDurationMs: 1, autonomyRatio: 0.83, scenesCompleted: 25, scenes_detoured: {},
        mastery: { "c-particules": 0.81, "c-spectres": 0.42, "c-geometrie": 0.5 },
        finalState: { concept_states: {
          "c-particules": { total_attempts: 3 }, "c-spectres": { total_attempts: 2 }, "c-geometrie": { total_attempts: 0 },
        } } },
      verdict: { scene_id: "s8", graded: false, signal: "scene_completed" },
      review_plan: { next_due_at: nextReview, concepts: ["c-particules"] },
    } as never, { conceptLabel: (id) => ({ "c-particules": "Particules", "c-spectres": "Spectres", "c-geometrie": "Géométrie" })[id] ?? id, locale: "fr" });
    expect(md).toMatch(/Leçon terminée/);
    expect(md).toContain("Particules");
    expect(md).toContain("Spectres");
    expect(md).not.toContain("Géométrie"); // never graded: not claimed either way
    expect(md).toContain(formatReviewDate(nextReview, "fr"));
    expect(md).not.toMatch(/0\.\d/);
  });
});
