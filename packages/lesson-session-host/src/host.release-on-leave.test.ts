// packages/lesson-session-host/src/host.release-on-leave.test.ts
//
// What an answer releases, and when (integration wave, lead decisions I-1 and I-2):
//   I-1  a graded key-point or audit scene's reference — its key points (an audit's planted flaws)
//        and its model answer — is data on the verdict, rendered under its own headings in the
//        verdict's display_markdown and feedback.md; the feedback text does not repeat it.
//   I-2  the passages a scene cites are released only when the learner leaves that scene for good: a
//        right answer, or a next scene that is not the same item again (replay) nor another item on
//        the same point (remediate_alt). A wrong answer followed by a retry releases nothing, and the
//        reference waits too; the passages held back come with the answer that finally leaves the scene.
// What leaves the server is read the way every transport serves it: publicTransition (the host's own
// presentation still holds the full scene, which the transports project).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verdictDeck } from "@studium/lesson-session";
import { SessionHost } from "./host.js";
import { publicTransition } from "./public-scene.js";
import { SessionWorkspace } from "./session-workspace.js";

/** A transition as a transport serves it, as text. */
const served = (t: Parameters<typeof publicTransition>[0]) => JSON.stringify(publicTransition(t));

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "release-on-leave-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const evidence = (quote: string) => ({
  bibliographic_refs: [{ perspicacite_doc_id: "d1", title: "Atkins", authors: ["Atkins"], excerpt: quote,
    relevance_score: 0.9, prov_derived_from: "https://example.org/atkins" }],
  enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-01T00:00:00Z", degraded: false },
});
const quiz = (id: string, concept: string, quote: string) => ({
  ...base(id, "quiz", concept), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "Oui.", feedback_incorrect: "Relis le passage.", hints: [], evidence: evidence(quote),
});
const ending = (concept: string) => ({ ...base("fin", "intro", concept), markdown: "Fin." });
const RETRY_ON_WRONG = {
  id: "retry", when: { answer_correct: "==false" }, action: { kind: "replay_current_scene", reason: "again" },
  modulator: "M1", explanation_short: "On reprend.",
};

function lesson(scenes: Array<{ concept_refs: string[]; [field: string]: unknown }>, rules: object[] = []) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: "release", source_plan_id: "p",
    metadata: { title: "Leçon", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules, validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}

async function start(bundle: object) {
  const bundles = tmp();
  write(bundles, "L.json", bundle);
  const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
  const started = await host.create("L.json", "ana");
  return { host, sessionId: started.sessionId, presentation: started.presentation };
}

const choiceOf = (presentation: { scene: unknown }, text: string) =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text)!.id;

describe("I-2 — cited passages are released when the learner leaves the scene for good", () => {
  it("a wrong answer retried on the same item releases nothing; the right answer releases the passage", async () => {
    const { host, sessionId, presentation } = await start(lesson([quiz("q1", "c1", "PASSAGE-Q1"), ending("c2")], [RETRY_ON_WRONG]));
    const wrong = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(presentation, "Faux") });
    expect(wrong.kind).toBe("replay");
    expect(wrong.verdict).toMatchObject({ scene_id: "q1", correct: false });
    expect(wrong.verdict?.sources).toBeUndefined();
    expect(served(wrong)).not.toContain("PASSAGE-Q1");

    const right = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(host.currentPresentation(sessionId), "Juste") });
    expect(right.verdict?.sources).toEqual([{ title: "Atkins", quote: "PASSAGE-Q1", url: "https://example.org/atkins" }]);
    expect(right.verdict?.display_markdown).toContain("« PASSAGE-Q1 »");
  });

  it("another item on the same point holds both passages back until the learner moves on", async () => {
    const { host, sessionId, presentation } = await start(lesson(
      [quiz("q1", "c1", "PASSAGE-Q1"), quiz("q2", "c1", "PASSAGE-Q2"), ending("c2")], [RETRY_ON_WRONG]));
    const wrong = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(presentation, "Faux") });
    expect(wrong.kind).toBe("remediate_alt");
    expect(served(wrong)).not.toContain("PASSAGE-Q1");

    const right = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(host.currentPresentation(sessionId), "Juste") });
    expect(right.verdict?.scene_id).toBe("q2");
    expect(right.verdict?.sources?.map((s) => s.quote).sort()).toEqual(["PASSAGE-Q1", "PASSAGE-Q2"]);
    expect(right.verdict?.display_markdown).toContain("« PASSAGE-Q1 »");
  });

  it("a prerequisite detour to another item on the same point holds the passage back too", async () => {
    // The graph gate (W1 of wave 2): q-base-1 answered wrong, c-dep needs `base`, so the learner is
    // sent to the unseen item q-base-2 on the same point before resuming c-dep.
    const bundle = {
      ...lesson([quiz("q-base-1", "base", "PASSAGE-B1"), { ...base("c-dep", "concept", "dep"), markdown: "Suite." },
        quiz("q-base-2", "base", "PASSAGE-B2")]),
      learning_workflow_graph: { schema_version: "1.0", course_id: "k", nodes: [
        { id: "concept:base", node_kind: "concept", title: "base", bloom_level: "understand" },
        { id: "concept:dep", node_kind: "concept", title: "dep", bloom_level: "understand" },
      ], edges: [{ id: "e", relation: "prerequisite_for", source: "concept:dep", target: "concept:base" }] },
    };
    const { host, sessionId, presentation } = await start(bundle);
    const detour = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(presentation, "Faux") });
    expect(detour.kind).toBe("remediate");
    expect(detour.navigation).toMatchObject({ scene_id: "q-base-2", returns_to: "c-dep" });
    expect(served(detour)).not.toContain("PASSAGE-B1");

    const right = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(host.currentPresentation(sessionId), "Juste") });
    expect(right.verdict?.sources?.map((s) => s.quote).sort()).toEqual(["PASSAGE-B1", "PASSAGE-B2"]);
  });

  it("a wrong answer that moves on to another point releases the passage", async () => {
    const { host, sessionId, presentation } = await start(lesson([quiz("q1", "c1", "PASSAGE-Q1"), ending("c2")]));
    const wrong = await host.respond(sessionId, { kind: "quiz_choice", choiceId: choiceOf(presentation, "Faux") });
    expect(wrong.kind).toBe("next");
    expect(wrong.verdict?.sources).toEqual([{ title: "Atkins", quote: "PASSAGE-Q1", url: "https://example.org/atkins" }]);
  });
});

describe("I-1 — the reference is data on the verdict, laid out under its own headings", () => {
  const explainBack = {
    ...base("e", "explain_back", "c1"), prompt: "Explique pourquoi le signe change.",
    key_points: [{ id: "k1", text: "POINT-UN", cues: ["signe"] }, { id: "k2", text: "POINT-DEUX", cues: ["lobe"] }],
    model_explanation: "MODÈLE-SECRET", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
  };

  it("a production answer releases its key points and model answer in the verdict, never outside it", async () => {
    const { host, sessionId } = await start(lesson([explainBack, ending("c2")]));
    const t = await host.respond(sessionId, { kind: "explanation", text: "Le signe change entre les lobes." });
    expect(t.verdict).toMatchObject({ key_points: ["POINT-UN", "POINT-DEUX"], model_answer: "MODÈLE-SECRET", reference_kind: "key_points" });
    expect(t.verdict?.display_markdown).toContain("**Compare ta réponse à ces points clés :**\n\n- POINT-UN\n- POINT-DEUX");
    expect(t.verdict?.display_markdown).toContain("**Réponse modèle**\n\nMODÈLE-SECRET");
    // The feedback does not repeat the reference (it is empty offline: nothing measured the answer).
    expect(t.verdict?.display_markdown.split("POINT-UN")).toHaveLength(2);
    const { verdict: _verdict, ...outside } = publicTransition(t);
    expect(JSON.stringify(outside)).not.toMatch(/POINT-UN|MODÈLE-SECRET/);
  });

  it("feedback.md lays the reference out the same way", async () => {
    const { host, sessionId } = await start(lesson([explainBack, ending("c2")]));
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "Le signe change entre les lobes." }));
    await ws.ingest(sessionId);
    const feedback = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(feedback).toContain("**Compare ta réponse à ces points clés :**\n\n- POINT-UN\n- POINT-DEUX");
    expect(feedback).toContain("**Réponse modèle**\n\nMODÈLE-SECRET");
  });

  it("an audit answered wrong and retried holds its planted flaws and correction back until it is left", async () => {
    const audit = {
      ...base("f", "spot_the_flaw", "c1"), flawed_content: "N : 1s2 2s2 2p4.", verdict_deck: true,
      claims: [{ id: "f1", text: "AFFIRMATION-FAUSSE", flaws_expected: ["hund"] }],
      sound_claims: [{ id: "ok", text: "AFFIRMATION-JUSTE" }],
      model_correction: "CORRECTION-SECRÈTE", rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
      evidence: evidence("PASSAGE-AUDIT"),
    };
    const { host, sessionId } = await start(lesson([audit, ending("c2")], [RETRY_ON_WRONG]));
    const deck = verdictDeck(audit.claims, audit.sound_claims, audit.id);
    const marks = (right: boolean) => deck.map((item) => ({ token: item.token, flagged: right ? item.flawed : !item.flawed }));

    const wrong = await host.respond(sessionId, { kind: "flaw_verdicts", verdicts: marks(false) });
    expect(wrong.kind).toBe("replay");
    expect(wrong.verdict).toMatchObject({ scene_id: "f", correct: false });
    expect(wrong.verdict).not.toHaveProperty("key_points");
    expect(wrong.verdict).not.toHaveProperty("model_answer");
    expect(served(wrong)).not.toMatch(/CORRECTION-SECRÈTE|PASSAGE-AUDIT|défauts plantés :/);

    const right = await host.respond(sessionId, { kind: "flaw_verdicts", verdicts: marks(true) });
    expect(right.verdict).toMatchObject({
      correct: true, key_points: ["AFFIRMATION-FAUSSE"], model_answer: "CORRECTION-SECRÈTE", reference_kind: "planted_flaws",
    });
    expect(right.verdict?.display_markdown).toContain("**Compare ton audit aux défauts plantés :**\n\n- AFFIRMATION-FAUSSE");
    expect(right.verdict?.display_markdown).toContain("**Correction modèle**\n\nCORRECTION-SECRÈTE");
    expect(right.verdict?.display_markdown).toContain("« PASSAGE-AUDIT »");
  });

  // Integration tail T3: an offline ai_critique put the claims that hid a flaw, with their expected flaws,
  // in verdict.feedback, which withoutReference keeps — so a replay showed them before the retry. They
  // are reference data now (key_points, reference_kind "flawed_claims"), withheld until the scene is left.
  it("an offline critique replayed holds its flawed claims back; the answer that leaves it lays them out", async () => {
    const critique = {
      ...base("k", "ai_critique", "c1"),
      claims: [{ id: "a", text: "AFFIRMATION-PIÈGE", flaws_expected: ["DÉFAUT-ATTENDU"] },
        { id: "b", text: "AFFIRMATION-SAINE", flaws_expected: [] }],
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    };
    // Offline, nothing grades a critique, so the rule routes on the ungraded attempt: replay once.
    const REPLAY_FIRST = {
      id: "again", when: { ungraded_attempts: "==1" }, action: { kind: "replay_current_scene", reason: "again" },
      modulator: "M1", explanation_short: "On reprend.",
    };
    const { host, sessionId } = await start(lesson([critique, ending("c2")], [REPLAY_FIRST]));
    const first = await host.respond(sessionId, { kind: "critique", text: "Je doute de la première affirmation." });
    expect(first.kind).toBe("replay");
    expect(first.verdict).not.toHaveProperty("key_points");
    expect(first.verdict).not.toHaveProperty("reference_kind");
    expect(served(first)).not.toMatch(/AFFIRMATION-PIÈGE|DÉFAUT-ATTENDU/);

    const left = await host.respond(sessionId, { kind: "critique", text: "La première affirmation généralise trop." });
    expect(left.kind).not.toBe("replay");
    expect(left.verdict).toMatchObject({ key_points: ["AFFIRMATION-PIÈGE (DÉFAUT-ATTENDU)"], reference_kind: "flawed_claims" });
    expect(left.verdict?.feedback ?? "").not.toContain("AFFIRMATION-PIÈGE");
    const shown = left.verdict?.display_markdown ?? "";
    expect(shown).toContain("**Compare ta critique aux affirmations qui cachaient un défaut :**\n\n- AFFIRMATION-PIÈGE (DÉFAUT-ATTENDU)");
    expect(shown.split("AFFIRMATION-PIÈGE")).toHaveLength(2);
    expect(shown).not.toContain("AFFIRMATION-SAINE");
  });

  it("feedback.md lays an offline critique's flawed claims out under the same heading", async () => {
    const critique = {
      ...base("k", "ai_critique", "c1"),
      claims: [{ id: "a", text: "AFFIRMATION-PIÈGE", flaws_expected: ["DÉFAUT-ATTENDU"] }],
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
    };
    const { host, sessionId } = await start(lesson([critique, ending("c2")]));
    const dir = tmp();
    const ws = new SessionWorkspace(host, dir);
    await ws.writeStep(sessionId);
    writeFileSync(join(dir, "response.json"), JSON.stringify({ text: "La première affirmation généralise trop." }));
    await ws.ingest(sessionId);
    const feedback = readFileSync(join(dir, "feedback.md"), "utf8");
    expect(feedback).toContain("**Compare ta critique aux affirmations qui cachaient un défaut :**\n\n- AFFIRMATION-PIÈGE (DÉFAUT-ATTENDU)");
    expect(feedback.split("AFFIRMATION-PIÈGE")).toHaveLength(2);
  });
});
