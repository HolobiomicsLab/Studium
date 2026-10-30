// packages/lesson-session-host/src/review-choice.test.ts
//
// L-8 (RFR-07, R-en-09, H1, H2, CC-4): which scene a review plays, and when the plan may send the
// learner to one.
//   - Only a scene whose PRIMARY concept (concept_refs[0], the one the graders score) is the concept:
//     a scene that merely mentions it would grade another concept, and the plan would propose the same
//     review every day.
//   - Never a diagnostic (« what do you already know? »): scene.diagnostic, or — in a bundle with no
//     diagnostic flag at all — the production scene right after a meta_checkpoint.
//   - Without a judge, an answer-graded scene (a quiz, a verdict deck) first: nothing else re-measures.
//   - The plan decides playability with the same function, and start_review_session drops the
//     unplayable concepts BEFORE it takes max_items.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import { isDiagnosticScene, pickReviewScene } from "./review-session.js";
import { SessionHost } from "./host.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");

const scene = (id: string, type: string, concepts: string[], extra: object = {}) => ({
  id, type, title: `T ${id}`, objective_refs: [], concept_refs: concepts, estimated_seconds: 60, adaptation_hooks: [], ...extra,
});
function bundle(scenes: object[]): LessonBundle {
  return {
    schema_version: "1.4", bundle_id: "L", source_plan_id: "p",
    metadata: { title: "Leçon", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: [{ id: "c1", title: "Un", description: "d", bloom_level_target: "understand" }],
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  } as unknown as LessonBundle;
}

describe("pickReviewScene (L-8)", () => {
  it("never reviews a concept with a scene that only mentions it", () => {
    const lesson = bundle([scene("q-other", "quiz", ["c2", "c1"]), scene("e-other", "explain_back", ["c2", "c1"])]);
    expect(pickReviewScene(lesson, "c1", null)).toBeNull();
    expect(pickReviewScene(lesson, "c1", null, { judge: true })).toBeNull();
    expect(pickReviewScene(lesson, "c2", null)?.id).toBe("q-other");
  });

  it("never replays a diagnostic: a flagged scene, or the production scene after a meta_checkpoint", () => {
    const flagged = bundle([
      scene("meta", "meta_checkpoint", ["c1"], { diagnostic: true }),
      scene("diag", "explain_back", ["c1"], { diagnostic: true }),
      scene("e-1", "explain_back", ["c1"]),
    ]);
    expect(pickReviewScene(flagged, "c1", null, { judge: true })?.id).toBe("e-1");
    expect(isDiagnosticScene(flagged, flagged.scenes[1]!)).toBe(true);
    // A bundle written before the flag existed: the production scene right after the checkpoint.
    const legacy = bundle([
      scene("intro", "intro", ["c1"]),
      scene("meta", "meta_checkpoint", ["c1"]),
      scene("diag", "explain_back", ["c1"]),
      scene("e-1", "explain_back", ["c1"]),
    ]);
    expect(isDiagnosticScene(legacy, legacy.scenes[2]!)).toBe(true);
    expect(isDiagnosticScene(legacy, legacy.scenes[3]!)).toBe(false);
    expect(pickReviewScene(legacy, "c1", null, { judge: true })?.id).toBe("e-1");
    expect(pickReviewScene(bundle([scene("meta", "meta_checkpoint", ["c1"]), scene("diag", "explain_back", ["c1"])]), "c1", null)).toBeNull();
    // Once a bundle carries flags, they alone decide.
    const declared = bundle([
      scene("meta", "meta_checkpoint", ["c1"], { diagnostic: false }),
      scene("e-0", "explain_back", ["c1"], { diagnostic: false }),
    ]);
    expect(pickReviewScene(declared, "c1", null, { judge: true })?.id).toBe("e-0");
  });

  it("without a judge, prefers an answer-graded scene, even the one answered last", () => {
    const lesson = bundle([
      scene("e-1", "explain_back", ["c1"]),
      scene("audit", "summary_audit", ["c1"]),
      scene("q-1", "quiz", ["c1"]),
    ]);
    expect(pickReviewScene(lesson, "c1", null)?.id).toBe("q-1");
    expect(pickReviewScene(lesson, "c1", "q-1")?.id).toBe("q-1");
    // With a judge every retrieval scene measures: the one not answered last comes first.
    expect(pickReviewScene(lesson, "c1", "e-1", { judge: true })?.id).toBe("audit");
    // A verdict deck is scored against its key like a quiz.
    const deck = bundle([scene("e-1", "explain_back", ["c1"]), scene("flaw", "spot_the_flaw", ["c1"], { verdict_deck: true })]);
    expect(pickReviewScene(deck, "c1", null)?.id).toBe("flaw");
    // No graded scene: a production scene still reviews (self-rated).
    expect(pickReviewScene(bundle([scene("e-1", "explain_back", ["c1"])]), "c1", null)?.id).toBe("e-1");
  });
});

// --- through the host ----------------------------------------------------------------------------
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "review-choice-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function write(root: string, ref: string, data: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(data));
}
const quiz = (id: string, concepts: string[]) => ({
  ...scene(id, "quiz", concepts), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const communicationSim = (id: string, concept: string) => ({
  ...scene(id, "communication_sim", [concept]), scenario: "Explique à un camarade.", prompt: "Pourquoi ?",
  key_points: [{ id: "kp", text: "un point", cues: ["lobe"] }], model_response: "modèle",
  rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
});
function lesson(id: string, scenes: Array<{ concept_refs: string[] }>) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: `Leçon ${id}`, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}
const idOf = (presentation: { scene: unknown }, text: string): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text)!.id;
function movableClock(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now).toISOString() }, set: (ms: number) => { now = ms; } };
}

describe("the plan and the review session agree on what can be reviewed (H1, H2, CC-4)", () => {
  it("a concept the remaining lesson only mentions is not playable: the plan does not send the learner there", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-side", ["c-side"])]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation, "Juste") });
    // The lesson that graded c-side is gone; the one left only mentions it after its own concept.
    rmSync(join(bundles, "A.json"));
    write(bundles, "M.json", lesson("lesson-M", [quiz("s-main", ["c-main", "c-side"])]));
    set(T0 + 7 * DAY);

    const plan = await host.studyPlan("ana");
    expect(plan.due_reviews).toEqual([expect.objectContaining({ concept_id: "c-side", playable: false })]);
    expect(plan.next_step.action).not.toBe("review");
    expect(await host.startReview("ana")).toMatchObject({ status: "nothing_due", not_playable: ["c-side"] });
  });

  it("start_review_session takes max_items among the playable concepts, not among all of them", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-u1", ["c-u1"]), quiz("s-u2", ["c-u2"])]));
    write(bundles, "B.json", lesson("lesson-B", [quiz("s-p", ["c-p"])]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    const first = await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation, "Juste") });
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf((first as unknown as { presentation: { scene: unknown } }).presentation, "Juste") });
    const b = await host.create("B.json", "ana");
    await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: idOf(b.presentation, "Faux") }); // c-p: to relearn
    // A's concepts (mastered, due first) can no longer be played: their only lesson left has no retrieval scene.
    rmSync(join(bundles, "A.json"));
    write(bundles, "C.json", lesson("lesson-C", [communicationSim("s-c1", "c-u1"), communicationSim("s-c2", "c-u2")]));
    set(T0 + 7 * DAY);

    const plan = await host.studyPlan("ana");
    expect(plan.next_step).toMatchObject({ action: "review", tool: "start_review_session" });
    const review = await host.startReview("ana", { maxItems: 1 });
    if (review.status !== "started") throw new Error(`expected a review, got ${JSON.stringify(review)}`);
    expect(review.review.items.map((i) => i.concept_id)).toEqual(["c-p"]);
    expect(review.review.not_playable?.sort()).toEqual(["c-u1", "c-u2"]);
  });

  it("a review plays from the lesson on disk that reviews the concept, not the first one that lists it, and the plan names it", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-a", ["c-x"])]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation, "Juste") });
    rmSync(join(bundles, "A.json"));
    // Listed first, B only mentions c-x after its own concept; C reviews it.
    write(bundles, "B.json", lesson("lesson-B", [quiz("s-b", ["c-b", "c-x"])]));
    write(bundles, "C.json", lesson("lesson-C", [quiz("s-c", ["c-x"])]));
    set(T0 + 7 * DAY);

    const plan = await host.studyPlan("ana");
    expect([...plan.due_reviews, ...plan.relearn, ...plan.unmeasured_reviews]).toEqual([expect.objectContaining({
      concept_id: "c-x", playable: true, lesson: { bundle_ref: "C.json", title: "Leçon lesson-C" }, scene_id: "s-c",
    })]);
    expect(plan.next_step).toMatchObject({ action: "review" });
    const review = await host.startReview("ana");
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    expect(review.review.items).toEqual([expect.objectContaining({ concept_id: "c-x", lesson_title: "Leçon lesson-C", scene_id: "r1:s-c" })]);
  });

  it("names the due concepts it cannot play when nothing else is due (H2)", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-a", ["c-side"])]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation, "Juste") });
    rmSync(join(bundles, "A.json"));
    write(bundles, "M.json", lesson("lesson-M", [quiz("s-main", ["c-main", "c-side"])]));
    set(T0 + 7 * DAY);
    const none = await host.startReview("ana");
    if (none.status !== "nothing_due") throw new Error(`expected nothing due, got ${none.status}`);
    expect(none.display_markdown).toContain("« Notion c-side »");
    expect(none.display_markdown).not.toContain("aucune révision n'est encore planifiée");
  });

  it("without a judge, a review replays the graded quiz rather than the diagnostic or the self-rated scene", async () => {
    const bundles = tmp();
    const diagnostic = { ...scene("s-diag", "explain_back", ["c1"]), prompt: "Sans rien chercher : que sais-tu ?",
      key_points: [{ id: "kp", text: "un point", cues: ["x"] }], model_explanation: "modèle", rubric: { completeness: 1, evidence_quality: 1, tone: 1 } };
    const meta = { ...scene("s-meta", "meta_checkpoint", ["c1"]), pre_question: "Confiance ?", post_question: "Et maintenant ?", scale_labels: ["0", "1", "2", "3", "4"] };
    write(bundles, "D.json", lesson("lesson-D", [meta, diagnostic, quiz("s-q", ["c1"])]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const s = await host.create("D.json", "ana");
    await host.respond(s.sessionId, { kind: "confidence", value: 2 });
    await host.respond(s.sessionId, { kind: "reply", text: "Je ne sais pas grand-chose." });
    const now = host.currentPresentation(s.sessionId);
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(now, "Faux") });
    set(T0 + 7 * DAY);
    const review = await host.startReview("ana");
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    expect(review.review.items).toEqual([expect.objectContaining({ concept_id: "c1", scene_id: "r1:s-q" })]);
  });
});
