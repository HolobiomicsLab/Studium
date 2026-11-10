// packages/lesson-session-host/src/chat-display.test.ts
//
// HJ-4 / R3: every presentation and transition carries a localized display_markdown a chat client
// shows as is. It is built from the public projection only, so no answer key reaches it before the
// answer; it never prints a mastery number, a rule id or an internal reason code.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import {
  presentationMarkdown, transitionMarkdown, verdictMarkdown, referenceMarkdown, recallRatedMarkdown, promptsMarkdown, promptAnswerMarkdown,
  formatReviewDate, completionSplit, sourcesMarkdown,
} from "./chat-display.js";
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

  it("shows the claims of an ai_critique scene, numbered, and none of their expected flaws (D4)", () => {
    const scene = {
      id: "s-crit", type: "ai_critique", title: "Critique", objective_refs: [], concept_refs: ["c1"], estimated_seconds: 0,
      adaptation_hooks: [], rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
      claims: [
        { id: "k1", text: "Le score prouve que la méthode est exacte.", flaws_expected: ["corrélation causale"] },
        { id: "k2", text: "Deux groupes ont été comparés.", flaws_expected: [] },
      ],
    };
    const fr = presentationMarkdown(presentation(scene));
    expect(fr).toContain("1. Le score prouve que la méthode est exacte.");
    expect(fr).toContain("2. Deux groupes ont été comparés.");
    expect(fr).not.toContain("corrélation causale");
    const en = presentationMarkdown(presentation(scene, 0, { locale: "en" }));
    expect(en).toContain("AI claims to critique");
    expect(en).toContain("1. Le score prouve que la méthode est exacte.");
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

  it("includes an equation, its title and legend for a text-only chat harness", () => {
    const scene = ATOMISTIQUE.scenes.find((candidate) => candidate.id === "s1-concept-particules")!;
    const md = presentationMarkdown(presentation(scene, ATOMISTIQUE.scenes.indexOf(scene)));
    expect(md).toContain("**Nombre de masse**");
    expect(md).toContain("$$\nA = Z + N\n$$");
    expect(md).toContain("- A : nombre de masse");
    expect(md).toContain("- Z : numéro atomique, égal au nombre de protons");
    expect(md).toContain("- N : nombre de neutrons");
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

  it("warns on the first screen when the lesson changed after its recorded approval (RT-4)", () => {
    const p = presentation(ATOMISTIQUE.scenes[0], 0, {
      authoring: { mode: "teacher", author_is_learner: false, drafted_by: "teacher", validated: true,
        judge: false, notice: null, approval: { recorded: true, matches: false } },
    });
    // L-5 typesets French learner copy, including the non-breaking space before a colon.
    expect(presentationMarkdown(p, { firstScreen: true })).toContain(
      "cette leçon a été modifiée depuis son approbation par l'enseignant",
    );
    expect(presentationMarkdown(p)).not.toContain("depuis son approbation");
    const en = { ...(p as object), locale: "en" } as never;
    expect(presentationMarkdown(en, { firstScreen: true })).toContain(
      "this lesson changed after the teacher approved it",
    );
  });

  it("attributes a reading scene with title, URL and licence before any answer (L-3)", () => {
    const reading = {
      id: "read", type: "concept", title: "Read", objective_refs: [], concept_refs: ["c"],
      estimated_seconds: 30, adaptation_hooks: [], markdown: "A source-backed explanation.",
      evidence: { bibliographic_refs: [{ title: "Open source", excerpt: "A cited passage.",
        prov_derived_from: "https://example.org/source", license: "CC BY 4.0" }] },
    };
    const fr = presentationMarkdown(presentation(reading));
    expect(fr).toContain("**Source**");
    expect(fr).toContain("«\u00a0A cited passage.\u00a0» — Open source (https://example.org/source), CC BY 4.0");
    const en = presentationMarkdown({ ...(presentation(reading) as object), locale: "en" } as never);
    expect(en).toContain("“A cited passage.” — Open source (https://example.org/source), CC BY 4.0");
    expect(en).not.toContain("«");
  });

  it("speaks English for an English lesson", () => {
    const scene = { ...ATOMISTIQUE.scenes[0], title: "Welcome" };
    const md = presentationMarkdown({ ...(presentation(scene) as object), locale: "en" } as never);
    expect(md).toContain("Step 1 of");
    expect(md).not.toContain("Étape");
  });

  it("says the step once: the status line carries it, so the line under the title goes (walkthrough 2026-11-07)", () => {
    const scene = ATOMISTIQUE.scenes[0];
    const status = "Atomistique L1 · étape 1/32 · à lire";
    const withStatus = presentationMarkdown(presentation(scene), { statusLine: status });
    expect(withStatus).not.toMatch(/_Étape \d+ sur \d+_/);
    expect(withStatus.endsWith(`\`${status}\``)).toBe(true);
    const review = presentationMarkdown(presentation(scene), { review: true, statusLine: status });
    expect(review).not.toMatch(/_Révision \d+ sur \d+_/);
    const en = presentationMarkdown({ ...(presentation(scene) as object), locale: "en" } as never, { statusLine: "step 1/32 · to read" });
    expect(en).not.toMatch(/_Step \d+ of \d+_/);
    // Without a status line, the step stays under the title.
    expect(presentationMarkdown(presentation(scene))).toContain(`_Étape 1 sur ${ATOMISTIQUE.scenes.length}_`);
    expect(presentationMarkdown(presentation(scene), { review: true })).toContain(`_Révision 1 sur ${ATOMISTIQUE.scenes.length}_`);
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
    // L-6 changed navigation to copy selected only from navigation.kind: engine reasons can expose
    // a rule threshold or make a correctness claim about another answer.
    expect(md).toContain("On revoit d'abord une notion nécessaire.");
    expect(md).not.toContain("Prérequis à consolider d'abord.");
    expect(md).not.toContain(`Ensuite, on revient à «\u00a0${titleOf("s3-concept-orbitales")}\u00a0».`);
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
    // L-6 changed the contract: navigation is worded only from navigation.kind, because an engine
    // explanation can claim correctness about a different answer or expose threshold vocabulary.
    expect(md).toContain("On reprend cette question.");
    expect(md).not.toContain("Deux erreurs");
  });

  it("never exposes correctness, engine reasons, item or threshold vocabulary in navigation (L-6)", () => {
    const forbidden = /answered correctly|bonne réponse|errors_threshold|rule_|\bitem\b|seuil|threshold/i;
    for (const [kind, expected] of [
      ["gate_passed", "On poursuit la leçon."],
      ["gate_unassessable", "Cette notion n'a pas pu être mesurée ici"],
      ["skip_mastered", "On passe à la suite."],
    ] as const) {
      const md = transitionMarkdown({
        kind: "next", presentation: next,
        verdict: { scene_id: "x", graded: true, assessed_by: "none", signal: "answer_submitted" },
        navigation: { kind, scene_id: "y", rule_id: "rule_internal", reason: "item answered correctly, mastery below threshold", modulator: "M" },
      } as never);
      expect(md).toContain(expected);
      expect(md).not.toMatch(forbidden);
    }
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
    expect(md).toMatch(/je ne savais pas.*again/);
    expect(md).toMatch(/facile.*easy/);
    expect(md).toMatch(/jamais ta maîtrise/);
    expect(md).toContain("«\u00a0La fonction d'onde change de signe.\u00a0»");
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
      "**Compare ta réponse à ces points clés\u00a0:**",
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
    expect(fr).toContain("**Compare ton audit aux défauts plantés\u00a0:**\n\n- 2p holds four electrons");
    expect(fr).toContain("**Correction modèle**\n\nN: 1s2 2s2 2p3.");
    const en = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "en" });
    expect(en).toContain("**Compare your audit with the planted flaws:**\n\n- 2p holds four electrons");
    expect(en).toContain("**Model correction**\n\nN: 1s2 2s2 2p3.");
    const keyPoints = verdictMarkdown({ kind: "complete", summary: {}, verdict: { ...verdict, reference_kind: "key_points" } } as never, [], { locale: "en" });
    expect(keyPoints).toContain("**Compare your answer with these key points:**\n\n- 2p holds four electrons");
    expect(keyPoints).toContain("**Model answer**\n\nN: 1s2 2s2 2p3.");
  });

  it("labels a wrong quiz reference as the right answer (L-2)", () => {
    const verdict = { scene_id: "q", graded: true, assessed_by: "key", signal: "answer_submitted", correct: false,
      key_points: ["Carbon dioxide"], reference_kind: "correct_choice" };
    // Group E's fallback uses the same reference heading, including its colon (chat-format parity).
    expect(referenceMarkdown(verdict as never, "fr")).toContain("**La bonne réponse\u00a0:**\n\n- Carbon dioxide");
    expect(referenceMarkdown(verdict as never, "en")).toContain("**The right answer:**\n\n- Carbon dioxide");
  });

  it("marks only boolean verdicts and identifies an agent-drafted key (L-7, H7)", () => {
    const base = { kind: "complete", summary: {}, navigation: { kind: "complete" } };
    const ctx = { locale: "en" as const, authoring: { drafted_by: "agent" as const } };
    const key = verdictMarkdown({ ...base, verdict: { scene_id: "q", graded: true, assessed_by: "key",
      signal: "answer_submitted", correct: true } } as never, [], ctx);
    expect(key).toContain("✓ **Right.**");
    expect(key).toContain("Per the AI-drafted key — see the cited passage");
    const none = verdictMarkdown({ ...base, verdict: { scene_id: "p", graded: true, assessed_by: "none",
      signal: "answer_submitted", feedback: "Recorded." } } as never, [], ctx);
    expect(none).toContain("No judge assessed it");
    expect(none).not.toMatch(/[✓✗]/);
    const measured = verdictMarkdown({ ...base, verdict: { scene_id: "a", graded: true, assessed_by: "judge",
      signal: "audit_measured", feedback: "1 of 2 claims measured." } } as never, [], ctx);
    expect(measured).toContain("judge measured the evidence");
    expect(measured).not.toMatch(/[✓✗]/);
  });

  it("prints licences and locale-specific quotation marks on earned sources (L-3, R-en-04)", () => {
    const sources = [{ title: "Open source", quote: "Quoted words", url: "https://example.org", license: "CC BY-SA 4.0" }];
    expect(sourcesMarkdown(sources, "fr")).toContain("«\u00a0Quoted words\u00a0» — Open source (https://example.org), CC BY-SA 4.0");
    expect(sourcesMarkdown(sources, "en")).toContain("“Quoted words” — Open source (https://example.org), CC BY-SA 4.0");
  });

  it("labels a critique's reference as the claims that hid a flaw, in French and English (T3)", () => {
    const verdict = { scene_id: "k", graded: true, signal: "answer_submitted",
      key_points: ["n=3 proves the effect (small sample)"], reference_kind: "flawed_claims" };
    const fr = verdictMarkdown({ kind: "complete", summary: {}, verdict } as never, [], { locale: "fr" });
    expect(fr).toContain("**Compare ta critique aux affirmations qui cachaient un défaut\u00a0:**\n\n- n=3 proves the effect (small sample)");
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

  it("a completed lesson splits consolidated, practised and not measured concepts honestly", () => {
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
    expect(md).toContain("Notion consolidée\u00a0: Particules");
    expect(md).toContain("Spectres — Travaillée (2 réponses)");
    // L-6 changed this expectation: silence made an unmeasured concept look absent rather than honest.
    expect(md).toContain("Géométrie — Pas encore mesurée");
    expect(md).toContain(formatReviewDate(nextReview, "fr"));
    expect(md).not.toMatch(/0\.\d/);
    expect(completionSplit({
      mastery: { "c-particules": 0.81, "c-spectres": 0.42, "c-geometrie": null },
      finalState: { concept_states: {
        "c-particules": { total_attempts: 3 }, "c-spectres": { total_attempts: 2 }, "c-geometrie": { total_attempts: 0 },
      } },
    } as never)).toEqual({
      consolidated: ["c-particules"],
      practised: [{ concept_id: "c-spectres", answers: 2 }],
      not_measured: ["c-geometrie"],
    });
  });
});

// INT-STUDIUM-058, lot 1, task 1.5: the conversation text says where the learner is and who speaks.
// The model relays this text and adds nothing, so the status line and the voices have to be in it.
describe("the status line and the voices in the conversation text", () => {
  const quiz = ATOMISTIQUE.scenes.find((s) => s.type === "quiz")!;
  const STATUS = "Atomistique · étape 2/32 · 74 min · à toi de répondre";
  const VOICE = "Leçon rédigée par l'IA, non relue par un enseignant.";
  const verdictOf = (verdict: Record<string, unknown>, authoring: Record<string, unknown> = {}, locale = "fr") => verdictMarkdown({
    kind: "next", presentation: presentation(quiz, 1, { locale, authoring: { mode: "teacher", author_is_learner: false, validated: true, judge: false, notice: null, ...authoring } }),
    verdict: { scene_id: "s", graded: true, signal: "answer_submitted", ...verdict },
  } as never, []);

  it("ends a screen with the status line it is given, which takes over the step line, and adds nothing else", () => {
    const plain = presentationMarkdown(presentation(quiz, 1));
    const md = presentationMarkdown(presentation(quiz, 1), { statusLine: STATUS });
    // Test decision (walkthrough 2026-11-07): the step is said once, in the status line.
    const step = `\n\n_Étape 2 sur ${ATOMISTIQUE.scenes.length}_`;
    expect(plain).toContain(step);
    expect(md).toBe(`${plain.replace(step, "")}\n\n\`${STATUS}\``);
    expect(md.length - plain.length).toBeLessThanOrEqual(200);
  });

  it("opens a screen with the voice line it is given", () => {
    const plain = presentationMarkdown(presentation(quiz, 1));
    const md = presentationMarkdown(presentation(quiz, 1), { voiceLine: VOICE, statusLine: STATUS });
    expect(md.startsWith(`> ${VOICE}\n\n### `)).toBe(true);
    expect(md.endsWith(`\`${STATUS}\``)).toBe(true);
    expect(md.length - plain.length).toBeLessThanOrEqual(200);
  });

  it("carries both onto the next screen of a transition", () => {
    const transition = { kind: "next", presentation: presentation(quiz, 1), navigation: { kind: "replay", scene_id: quiz.id, rule_id: null, reason: null, modulator: null } };
    const md = transitionMarkdown(transition as never, { statusLine: STATUS, voiceLine: VOICE });
    expect(md.endsWith(`\`${STATUS}\``)).toBe(true);
    expect(md).toContain(`---\n\n> ${VOICE}\n\n### `);
  });

  it("says who assessed an answer: the author's key, or a judge", () => {
    expect(verdictOf({ assessed_by: "key", correct: true })).toBe("✓ **Juste.**\n\nÉvalué par la clé de l'auteur.");
    expect(verdictOf({ assessed_by: "judge", correct: false })).toContain("Évalué par un juge (modèle).");
    expect(verdictOf({ assessed_by: "key", correct: true }, {}, "en")).toContain("Assessed by the author's key.");
    expect(verdictOf({ assessed_by: "judge", correct: true }, {}, "en")).toContain("Assessed by a judge model.");
  });

  it("does not name the assessor twice, and names none when nobody assessed", () => {
    const agentKey = verdictOf({ assessed_by: "key", correct: true }, { drafted_by: "agent" });
    expect(agentKey).toContain("Selon la clé rédigée par l'IA");
    expect(agentKey).not.toContain("clé de l'auteur");
    const compared = verdictOf({ assessed_by: "key" });
    expect(compared).toContain("Réponse comparée à la clé.");
    expect(compared).not.toContain("Évalué par");
    expect(verdictOf({ assessed_by: "judge" })).not.toContain("Évalué par");
    expect(verdictOf({ assessed_by: "none" })).not.toContain("Évalué par");
  });
});

// INT-STUDIUM-058 § 2.6, task 5.2: what the server proposes, in the conversation text.
describe("the server's prompts in the conversation text", () => {
  const concept = ATOMISTIQUE.scenes.find((s) => s.type === "concept")!;
  const STATUS = "Atomistique · étape 1/32 · 75 min · à lire";
  const REVIEW = { id: "review_due:start", kind: "review_due", reason: "3 notions à revoir aujourd'hui", asks: true };
  const NOTICE = { id: "adaptation_notice:s1", kind: "adaptation_notice", reason: "Retour sur un prérequis.", asks: false };

  it("says a proposal after the screen and before the status line, with how to answer it", () => {
    const plain = presentationMarkdown(presentation(concept, 0), { statusLine: STATUS });
    const md = presentationMarkdown(presentation(concept, 0), { statusLine: STATUS, prompts: [REVIEW] });
    const body = plain.slice(0, -`\n\n\`${STATUS}\``.length);
    expect(md).toBe(`${body}\n\n> **Proposition\u00a0:** 3 notions à revoir aujourd'hui (proposition \`review_due:start\`)\n> _Tu peux accepter, ou dire «\u00a0plus tard\u00a0»._\n\n\`${STATUS}\``);
  });

  it("says a notice as it is: there is nothing to answer", () => {
    const md = presentationMarkdown(presentation(concept, 0), { statusLine: STATUS, prompts: [NOTICE, REVIEW] });
    expect(md).toContain("\n\n> Retour sur un prérequis.\n\n> **Proposition\u00a0:** 3 notions à revoir aujourd'hui (proposition `review_due:start`)\n");
  });

  it("is worded in the screen's language, and adds nothing when there is no prompt", () => {
    const en = presentationMarkdown(presentation(concept, 0, { locale: "en" }), { prompts: [{ ...REVIEW, reason: "3 concepts to review today" }] });
    expect(en.endsWith("> **Suggestion:** 3 concepts to review today (suggestion `review_due:start`)\n> _You can accept, or say “later”._")).toBe(true);
    expect(presentationMarkdown(presentation(concept, 0), { statusLine: STATUS, prompts: [] }))
      .toBe(presentationMarkdown(presentation(concept, 0), { statusLine: STATUS }));
  });

  it("carries the prompts onto the next screen of a transition", () => {
    const transition = { kind: "next", presentation: presentation(concept, 0), navigation: { kind: "advance", scene_id: concept.id, rule_id: null, reason: null, modulator: null } };
    const md = transitionMarkdown(transition as never, { statusLine: STATUS, prompts: [REVIEW] });
    expect(md.endsWith(`> **Proposition\u00a0:** 3 notions à revoir aujourd'hui (proposition \`review_due:start\`)\n> _Tu peux accepter, ou dire «\u00a0plus tard\u00a0»._\n\n\`${STATUS}\``)).toBe(true);
  });

  it("says the proposals of the end of a lesson after its completion, and those that follow a self-rating", () => {
    const MAP = { id: "map_offer", kind: "map_offer", reason: "Leçon terminée : la carte montre où en est chaque notion.", asks: true };
    const complete = { kind: "complete", summary: { scenes_completed: 3, mastery: {} } };
    const md = transitionMarkdown(complete as never, { prompts: [MAP] });
    expect(md.endsWith("> **Proposition\u00a0:** Leçon terminée\u00a0: la carte montre où en est chaque notion. (proposition `map_offer`)\n> _Tu peux accepter, ou dire «\u00a0plus tard\u00a0»._")).toBe(true);
    expect(promptsMarkdown([REVIEW], "fr")).toBe("> **Proposition\u00a0:** 3 notions à revoir aujourd'hui (proposition `review_due:start`)\n> _Tu peux accepter, ou dire «\u00a0plus tard\u00a0»._");
    expect(promptsMarkdown([], "fr")).toBe("");
  });

  it("answers a proposal in words a person reads, naming the call that follows an accepted one", () => {
    expect(promptAnswerMarkdown("review_due", "accepted", "fr")).toBe("Révision acceptée\u00a0: l'assistant ouvre la session de révision (`start_review_session`).");
    expect(promptAnswerMarkdown("review_due", "accepted", "en")).toBe("Review accepted: the assistant opens the review session (`start_review_session`).");
    expect(promptAnswerMarkdown("map_offer", "accepted", "fr")).toContain("`get_workflow_graph`");
    expect(promptAnswerMarkdown("forms_offer", "accepted", "fr")).toContain("`play_in_forms`");
    expect(promptAnswerMarkdown("next_lesson", "accepted", "en")).toContain("`get_study_plan`");
    expect(promptAnswerMarkdown("break", "accepted", "fr")).not.toContain("`");
    expect(promptAnswerMarkdown("review_due", "dismissed", "fr")).toBe("C'est noté, plus tard\u00a0: la leçon continue.");
    expect(promptAnswerMarkdown("forms_offer", "dismissed", "en")).toBe("Noted, later: the lesson goes on.");
  });
});
