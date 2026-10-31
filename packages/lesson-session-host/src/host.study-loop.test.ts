// L-5: exact display assertions use French non-breaking spaces; content/privacy contracts stay intact.
// packages/lesson-session-host/src/host.study-loop.test.ts
//
// The study loop through SessionHost (sprint 2026-10-30, W2): the FSRS memory kept first-class
// (RT-3), a review session once a concept falls due (SL-2, HJ-1), the study plan and the lesson list
// (HJ-5), the learner's self-rating (C4, D5), the text a chat shows and when (HJ-4, SL-5), whether
// progress survives a restart and where lessons live (C6, SL-1), a chat reply as an answer (HJ-4).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";
import { ResponseInputError } from "./reply-mapping.js";
import { AGENT_DRAFTED_NOTICE } from "./authoring.js";
import { calendarDate } from "./calendar.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "study-loop-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}

/** A clock the test moves: every answer, rating and review read takes its time from it. */
function movableClock(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now).toISOString() }, set: (ms: number) => { now = ms; }, advance: (ms: number) => { now += ms; } };
}

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const quiz = (id: string, concept: string, extra: object = {}) => ({
  ...base(id, "quiz", concept), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "BRAVO-RÉVÉLÉ", feedback_incorrect: "RATÉ-RÉVÉLÉ", hints: [], ...extra,
});
const explainBack = (id: string, concept: string) => ({
  ...base(id, "explain_back", concept), prompt: "Explique pourquoi le signe change.",
  key_points: [{ id: "kp", text: "POINT-CLÉ-SECRET", cues: ["signe"] }], model_explanation: "MODÈLE-SECRET",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
});

function lesson(id: string, scenes: Array<{ concept_refs: string[] }>, opts: { title?: string; authoring?: object } = {}) {
  const concepts = [...new Set(scenes.flatMap((s) => s.concept_refs))];
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: {
      title: opts.title ?? `Leçon ${id}`, target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie",
      ...(opts.authoring ? { authoring: opts.authoring } : {}),
    },
    concepts: concepts.map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}

/** The displayed id of a quiz choice: the host reshuffles and re-letters choices per scene. */
function idOf(presentation: { scene: unknown }, text = "Juste"): string {
  const choice = (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text);
  if (!choice) throw new Error(`no choice "${text}"`);
  return choice.id;
}

/** The one learner folder a durable host wrote, and a JSON file in it. */
function learnerFile(dataDir: string, name: string): Record<string, unknown> {
  const folder = readdirSync(dataDir).find((entry) => existsSync(join(dataDir, entry, name)));
  if (!folder) throw new Error(`no ${name} under ${dataDir}`);
  return JSON.parse(readFileSync(join(dataDir, folder, name), "utf8")) as Record<string, unknown>;
}

describe("RT-3 — the FSRS memory is first-class", () => {
  it("keeps every graded answer past the 50-entry history window, and a resumed lesson starts from it", async () => {
    const bundles = tmp();
    const data = tmp();
    write(bundles, "long.json", lesson("long", Array.from({ length: 60 }, (_, i) => quiz(`q${i}`, "c-signe"))));
    const { clock, advance } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock });
    const s = await host.create("long.json", "ana");
    for (let i = 0; i < 59; i += 1) {
      advance(60_000);
      // Right or wrong, every graded answer is one review.
      await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: "a" });
    }
    // The capped history no longer holds every answer; the memory still counts them all.
    expect(host.getState(s.sessionId).history.length).toBeLessThanOrEqual(50);
    expect(host.reviewQueue(s.sessionId)).toEqual([expect.objectContaining({ concept_id: "c-signe", reps: 59 })]);

    await host.close(s.sessionId);
    const resumed = await host.create("long.json", "ana");
    expect(resumed.resume).toMatchObject({ kind: "resumed", scenes_completed: 59 });
    expect(host.reviewQueue(resumed.sessionId)).toEqual([expect.objectContaining({ concept_id: "c-signe", reps: 59 })]);
  });
});

describe("write-through to the learner profile", () => {
  it("writes back only the concept states a session changed, never a stale warm-seeded copy", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-a", "c-signe")]));
    write(bundles, "A2.json", lesson("lesson-A2", [quiz("s-a2", "c-signe")]));
    // B declares c-signe (so it is warm-seeded from the profile) but only asks about c-autre.
    write(bundles, "B.json", { ...lesson("lesson-B", [quiz("s-b", "c-autre")]),
      concepts: ["c-signe", "c-autre"].map((c) => ({ id: c, title: c, description: "d", bloom_level_target: "understand" })) });
    write(bundles, "C.json", lesson("lesson-C", [quiz("s-c", "c-signe")]));
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    const b = await host.create("B.json", "ana"); // seeds c-signe with one attempt
    const a2 = await host.create("A2.json", "ana");
    await host.respond(a2.sessionId, { kind: "quiz_choice", choiceId: idOf(a2.presentation) }); // c-signe: two attempts
    await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: idOf(b.presentation) });  // B completes
    await host.close(b.sessionId);
    const c = await host.create("C.json", "ana");
    expect(host.getState(c.sessionId).concept_states["c-signe"]?.total_attempts).toBe(2);
  });
});

describe("write-through under concurrent answers", () => {
  it("keeps both reviews when two sessions of one learner answer at the same time", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-a", "c-a")]));
    write(bundles, "B.json", lesson("lesson-B", [quiz("s-b", "c-b")]));
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    const [a, b] = await Promise.all([host.create("A.json", "ana"), host.create("B.json", "ana")]);
    await Promise.all([
      host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) }),
      host.respond(b.sessionId, { kind: "quiz_choice", choiceId: idOf(b.presentation) }),
    ]);
    const later = await host.reinforcementStatusForLearner("ana", Date.now() + 60 * DAY);
    expect(later.due.map((t) => t.concept_id).sort()).toEqual(["c-a", "c-b"]);
    const plan = await host.studyPlan("ana", { nowMs: Date.now() + 60 * DAY });
    expect(plan.due_reviews.map((i) => i.lesson?.bundle_ref).sort()).toEqual(["A.json", "B.json"]);
  });
});

describe("start_review_session — a due concept can be reviewed (SL-2, HJ-1)", () => {
  it("plays the due scene from the lesson it was learned in, grades it and moves the memory", async () => {
    const bundles = tmp();
    const data = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock });
    const a = await host.create("A.json", "ana");
    const done = await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    expect(done.kind).toBe("complete");
    // HJ-1: a finished lesson says when its concepts come back.
    expect(done.review_plan).toMatchObject({ concepts: ["c-signe"] });
    expect(done.review_plan!.next_due_at).toBeGreaterThan(T0);
    // RFR-13: the day of next_due_at in the host's time zone (it was the UTC day, whatever the display said).
    expect(done.review_plan!.next_due_date).toBe(calendarDate(done.review_plan!.next_due_at!, host.timeZone));
    expect(done.display_markdown).toContain("**Leçon terminée.**");
    expect(done.display_markdown).toContain("Prochaine révision\u00a0:");

    const early = await host.startReview("ana");
    expect(early).toMatchObject({ status: "nothing_due", next_review_at: done.review_plan!.next_due_at });
    if (early.status !== "nothing_due") throw new Error("unreachable");
    expect(early.display_markdown).toMatch(/^Rien à réviser pour l'instant\. Prochaine révision\u00a0: /);
    const firstInterval = early.next_review_at! - T0;

    set(T0 + 7 * DAY);
    // HJ-1: a learner-only status names the lesson and the scene to review with.
    const status = await host.reinforcementStatusForLearner("ana");
    expect(status.due).toEqual([expect.objectContaining({
      concept_id: "c-signe", scene_id: "s-q", source: "profile", bundle_ref: "A.json", lesson_title: "Leçon lesson-A",
    })]);

    const review = await host.startReview("ana");
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    // UX-03: retain the lesson's original reference on each review item.
    expect(review.review.items).toEqual([
      { concept_id: "c-signe", concept: "Notion c-signe", lesson_title: "Leçon lesson-A", scene_id: "r1:s-q", bundle_ref: "A.json" },
    ]);
    expect(review.presentation.scene.id).toBe("r1:s-q");
    expect(review.presentation.display_markdown).toContain("Révision 1 sur 1");
    expect(review.presentation.display_markdown).not.toContain("BRAVO-RÉVÉLÉ");

    const graded = await host.respond(review.sessionId, { kind: "reply", text: `réponse ${idOf(review.presentation)}` });
    expect(graded).toMatchObject({ kind: "complete", verdict: { scene_id: "r1:s-q", correct: true } });
    expect(graded.display_markdown).toContain("**Révision terminée.**");

    // The review moved the memory: nothing is due now, and the next interval is longer than the first.
    const after = await host.startReview("ana");
    if (after.status !== "nothing_due") throw new Error(`expected nothing due, got ${after.status}`);
    expect(after.next_review_at! - (T0 + 7 * DAY)).toBeGreaterThan(firstInterval);
    // A review is never recorded as a lesson completed, and it routes the concept back to its lesson.
    expect(learnerFile(data, "profile.json")["completed_lessons"]).toEqual(["lesson-A"]);
    const study = learnerFile(data, "study.json") as { concepts: Record<string, unknown>; lessons: Record<string, unknown> };
    expect(study.concepts["c-signe"]).toEqual({ bundle_ref: "A.json", bundle_id: "lesson-A", scene_id: "s-q", lesson_title: "Leçon lesson-A" });
    expect(Object.keys(study.lessons)).toEqual(["lesson-A"]);
  });
});

describe("start_review_session when a lesson is gone", () => {
  it("reviews from another lesson that teaches the concept, else says which concepts it cannot play", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    write(bundles, "A-bis.json", lesson("lesson-A-bis", [quiz("s-bis", "c-signe")]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    rmSync(join(bundles, "A.json"));
    set(T0 + 7 * DAY);

    const fallback = await host.startReview("ana");
    if (fallback.status !== "started") throw new Error(`expected a review, got ${fallback.status}`);
    expect(fallback.review.items).toEqual([expect.objectContaining({ concept_id: "c-signe", lesson_title: "Leçon lesson-A-bis", scene_id: "r1:s-bis" })]);
    expect(fallback.review).not.toHaveProperty("not_playable");

    rmSync(join(bundles, "A-bis.json"));
    const none = await host.startReview("ana");
    expect(none).toMatchObject({ status: "nothing_due", not_playable: ["c-signe"] });
    // The plan lists the concept but does not send the learner to a review that cannot be played.
    const plan = await host.studyPlan("ana");
    expect(plan.due_reviews).toEqual([expect.objectContaining({ concept_id: "c-signe", lesson: null })]);
    expect(plan.next_step.action).not.toBe("review");
  });
});

describe("get_study_plan never sends the learner to a review no scene can play (R2)", () => {
  const communicationSim = (id: string, concept: string) => ({
    ...base(id, "communication_sim", concept), scenario: "Explique à un camarade.", prompt: "Pourquoi deux lobes ?",
    key_points: [{ id: "kp", text: "POINT-CLÉ-SECRET", cues: ["lobe"] }], model_response: "MODÈLE-SECRET",
    rubric: { completeness: 0.6, evidence_quality: 0.2, tone: 0.2 },
  });
  const runReproduction = (id: string, concept: string) => ({
    ...base(id, "reproduction", concept), task_card_id: "tc",
    steps: [{ step_id: "1", instruction: "Lance le calcul.", expected_input_schema: { type: "object" }, expected_output: "y" }],
    run_manifest: { capsule_ref: "fixtures/capsule-demo", cmd: ["python", "run.py"], expected_outputs: ["o"], verify_checks: ["c"] },
  });

  it.each([
    ["a communication_sim", communicationSim],
    ["a run-bound reproduction", runReproduction],
  ])("falls through when the concept's only lesson teaches it with %s", async (_label, scene) => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    // The quiz lesson is gone; the only lesson left that lists the concept has no retrieval scene.
    rmSync(join(bundles, "A.json"));
    write(bundles, "C.json", lesson("lesson-C", [scene("s-c", "c-signe")]));
    set(T0 + 7 * DAY);

    // The review session cannot play it...
    expect(await host.startReview("ana")).toMatchObject({ status: "nothing_due", not_playable: ["c-signe"] });
    // ...so the plan lists it, says so, and sends the learner elsewhere.
    const plan = await host.studyPlan("ana");
    expect(plan.due_reviews).toEqual([expect.objectContaining({
      concept_id: "c-signe", lesson: { bundle_ref: "C.json", title: "Leçon lesson-C" }, playable: false,
    })]);
    expect(plan.next_step.action).not.toBe("review");
    expect(plan.next_step).toMatchObject({ action: "start", arguments: { bundle_ref: "C.json" } });
  });

  it("still sends the learner to a review the session can play", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    const { clock, set } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    set(T0 + 7 * DAY);
    const plan = await host.studyPlan("ana");
    expect(plan.due_reviews).toEqual([expect.objectContaining({ concept_id: "c-signe", playable: true })]);
    expect(plan.next_step).toMatchObject({ action: "review", tool: "start_review_session" });
  });
});

describe("rate_recall — a self-rating schedules reviews, never mastery (C4, D5)", () => {
  it("moves the rated concept's memory, leaves its mastery, and refuses a rating nobody asked for", async () => {
    const bundles = tmp();
    write(bundles, "E.json", lesson("lesson-E", [explainBack("s-e", "c-signe"), quiz("s-q", "c-autre")]));
    const { clock } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const s = await host.create("E.json", "ana");

    const t = await host.respond(s.sessionId, { kind: "reply", text: "Le signe change entre les deux lobes." });
    expect(t.self_rating).toEqual({ requested: true, grades: ["again", "hard", "good", "easy"], scene_id: "s-e" });
    expect(t.verdict?.display_markdown).toContain("note ton rappel");
    expect(t.verdict?.display_markdown).toContain("elle ne change jamais ta maîtrise");
    expect(t.display_markdown).not.toContain("MODÈLE-SECRET");
    expect(host.reviewQueue(s.sessionId)).toEqual([]); // an ungraded answer is not a retrieval
    const mastery = structuredClone(host.getState(s.sessionId).concept_states);

    const rated = await host.rateRecall(s.sessionId, "s-e", "good");
    expect(rated).toMatchObject({ scene_id: "s-e", concept_id: "c-signe", grade: "good", source: "self_rated" });
    expect(rated.next_review_at).toBeGreaterThan(T0);
    // RFR-13: the day of next_review_at in the host's time zone, the day display_markdown prints.
    expect(rated.next_review_date).toBe(calendarDate(rated.next_review_at, host.timeZone));
    expect(rated.display_markdown).toMatch(/^Note enregistrée\. Prochaine révision\u00a0: .+\. Elle règle tes révisions, jamais ta maîtrise\.$/);
    expect(host.getState(s.sessionId).concept_states).toEqual(mastery);
    expect(host.reviewQueue(s.sessionId)).toEqual([expect.objectContaining({ concept_id: "c-signe", reps: 1 })]);

    // Never graded yet reviewed: due later for review, routed to its scene — and, since nobody measured
    // its mastery, never listed as a concept to relearn (lead decision I-3; it used to be in `relearn`).
    const later = await host.reinforcementStatusForLearner("ana", T0 + 60 * DAY);
    expect(later.relearn).toEqual([]);
    expect(later.unmeasured).toEqual([expect.objectContaining({ concept_id: "c-signe", scene_id: "s-e", bundle_ref: "E.json" })]);

    await expect(host.rateRecall(s.sessionId, "s-e", "easy")).rejects.toThrow(/no self-rating was requested for scene "s-e"/);
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(host.currentPresentation(s.sessionId)) });
    await expect(host.rateRecall(s.sessionId, "s-q", "good")).rejects.toThrow(/no self-rating was requested for scene "s-q"/);
  });

  it("a graded answer after a self-rating builds on it rather than replacing it", async () => {
    const bundles = tmp();
    write(bundles, "EQ.json", lesson("lesson-EQ", [explainBack("s-e", "c-signe"), quiz("s-q", "c-signe")]));
    const { clock, advance } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const s = await host.create("EQ.json", "ana");
    await host.respond(s.sessionId, { kind: "explanation", text: "Le signe change." });
    await host.rateRecall(s.sessionId, "s-e", "good");
    advance(DAY);
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(host.currentPresentation(s.sessionId)) });
    expect(host.reviewQueue(s.sessionId)).toEqual([expect.objectContaining({ concept_id: "c-signe", reps: 2 })]);
  });
});

describe("display_markdown — what a chat shows, and when (HJ-4, SL-5)", () => {
  const evidence = {
    bibliographic_refs: [{
      perspicacite_doc_id: "d1", doi: "10.1000/x", title: "Atkins, Chimie physique", authors: ["Atkins"],
      excerpt: "PASSAGE-QUI-RÉPOND", relevance_score: 0.9, prov_derived_from: "kb:chimie",
    }],
    enrichment_metadata: { enricher_version: "1", perspicacite_mode_used: "passages", timestamp: "2026-10-01T00:00:00Z", degraded: false },
  };

  it("shows the question without its key, then the feedback and the cited passage under the verdict only", async () => {
    const bundles = tmp();
    write(bundles, "C.json", lesson("lesson-C", [quiz("s-q", "c-signe", { evidence }), quiz("s-q2", "c-signe")]));
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    const s = await host.create("C.json", "ana");
    const first = s.presentation.display_markdown;
    expect(first).toContain("### Scène s-q");
    expect(first).toContain("_Étape 1 sur 2_");
    expect(first).toContain("Question s-q ?");
    const right = idOf(s.presentation);
    expect(first).toContain(`**${right})** Juste`);
    expect(first).toContain("Réponds avec la lettre de ton choix");
    expect(first).toContain("ta progression n'est gardée qu'en mémoire");
    for (const secret of ["BRAVO-RÉVÉLÉ", "RATÉ-RÉVÉLÉ", "PASSAGE-QUI-RÉPOND", "Atkins"]) expect(first).not.toContain(secret);

    const t = await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: right });
    expect(t.verdict?.sources).toEqual([{ title: "Atkins, Chimie physique", quote: "PASSAGE-QUI-RÉPOND", url: "https://doi.org/10.1000/x" }]);
    expect(t.verdict?.display_markdown).toContain("✓ **Juste.**");
    expect(t.verdict?.display_markdown).toContain("BRAVO-RÉVÉLÉ");
    expect(t.verdict?.display_markdown).toContain("«\u00a0PASSAGE-QUI-RÉPOND\u00a0» — Atkins, Chimie physique (https://doi.org/10.1000/x)");
    for (const secret of ["BRAVO-RÉVÉLÉ", "PASSAGE-QUI-RÉPOND"]) expect(t.display_markdown).not.toContain(secret);
    expect(t.display_markdown).toContain("Question s-q2 ?");
    // The warning and the notice belong to the first screen only.
    expect(t.display_markdown).not.toContain("gardée qu'en mémoire");
  });

  it("opens an agent-drafted lesson with the AI-drafted notice (C3)", async () => {
    const bundles = tmp();
    write(bundles, "G.json", { ...lesson("lesson-G", [quiz("s-q", "c-signe")], {
      authoring: { mode: "self_study", author_is_learner: true, drafted_by: "agent" },
    }), validated_by: "SELF-STUDY — not teacher-validated" });
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    const s = await host.create("G.json", "ana");
    expect(host.draftedBy(s.sessionId)).toBe("agent");
    expect(s.presentation.display_markdown.startsWith(`> ${AGENT_DRAFTED_NOTICE.fr.without_judge}`)).toBe(true);
  });
});

describe("persistence and the learner's library (C6, SL-1)", () => {
  it("says on start whether progress survives a restart", async () => {
    const bundles = tmp();
    const data = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    const ephemeral = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, defaultLearnerId: "moi" });
    expect(ephemeral.persistence()).toMatchObject({ durable: false, data_dir: null, learner_id_default: "moi" });
    expect(ephemeral.persistence().warning).toMatch(/lost when this server restarts/);
    expect(ephemeral.defaultLearnerId).toBe("moi");

    const durable = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data });
    const s = await durable.create("A.json");
    expect(s.persistence).toEqual({ durable: true, data_dir: data, library_root: null, learner_id_default: "anonymous" });
    expect(s.presentation.display_markdown).not.toContain("gardée qu'en mémoire");
  });

  it("serves and lists a lesson written into the library after start, and still confines every ref", async () => {
    const root = tmp();
    const bundles = join(root, "bundles");
    const library = join(root, "library");
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-signe")]));
    mkdirSync(library, { recursive: true });
    writeFileSync(join(root, "outside.json"), JSON.stringify(lesson("outside", [quiz("s-q", "c-signe")])));
    const host = new SessionHost({ bundlesRoot: bundles, libraryRoot: library, live: false, dataDir: null });
    expect((await host.listLessons()).lessons.map((l) => l.bundle_ref)).toEqual(["A.json"]);

    write(library, "mon-cours/lesson.json", lesson("mon-cours", [quiz("s-q", "c-neuf")], { title: "Mon cours" }));
    const listed = await host.listLessons({ query: "MON cours" });
    expect(listed.lessons).toEqual([expect.objectContaining({ bundle_ref: "mon-cours/lesson.json", title: "Mon cours", source: "library", scene_count: 1 })]);
    const s = await host.create("mon-cours/lesson.json", "ana");
    expect(s.presentation.scene.id).toBe("s-q");
    await expect(host.create("../outside.json", "ana")).rejects.toThrow(/escapes bundles root/);
    await expect(host.create("absent.json", "ana")).rejects.toThrow(/lesson not found: absent\.json.*call list_lessons/);
  });
});

describe("submit_response {kind: \"reply\"} (HJ-4)", () => {
  it("grades a chat reply as the scene's input, and refuses an id the quiz does not display", async () => {
    const bundles = tmp();
    write(bundles, "Q.json", lesson("lesson-Q", [quiz("s-1", "c-signe"), quiz("s-2", "c-signe")]));
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    const s = await host.create("Q.json", "ana");
    await expect(host.respond(s.sessionId, { kind: "quiz_choice", choiceId: "s1-b" })).rejects.toThrow(ResponseInputError);
    await expect(host.respond(s.sessionId, { kind: "reply", text: "je ne sais pas" })).rejects.toThrow(/displayed choice ids: /);
    // Neither refusal cost the learner an attempt: no signal reached the engine.
    expect(host.getState(s.sessionId).history).toEqual([]);
    expect(host.getState(s.sessionId).concept_states["c-signe"]?.total_attempts ?? 0).toBe(0);
    const t = await host.respond(s.sessionId, { kind: "reply", text: `Réponse ${idOf(s.presentation).toUpperCase()}` });
    expect(t.verdict).toMatchObject({ scene_id: "s-1", correct: true });
  });
});

describe("get_study_plan and list_lessons (HJ-5)", () => {
  it("say what to do now — start, continue, then review — and how far each lesson got", async () => {
    const library = tmp();
    write(library, "a/lesson.json", lesson("lesson-a", [quiz("s-q", "c-a")], { title: "Atomes" }));
    write(library, "b/lesson.json", lesson("lesson-b", [quiz("s-q", "c-b"), quiz("s-q2", "c-b")], { title: "Liaisons" }));
    utimesSync(join(library, "a/lesson.json"), new Date(T0 - 2 * DAY), new Date(T0 - 2 * DAY));
    utimesSync(join(library, "b/lesson.json"), new Date(T0 - DAY), new Date(T0 - DAY));
    const { clock } = movableClock(T0);
    const host = new SessionHost({ bundlesRoot: library, libraryRoot: library, live: false, dataDir: null, clock });

    const fresh = await host.studyPlan("ana");
    expect(fresh.next_step).toMatchObject({ action: "start", tool: "start_lesson_session", arguments: { bundle_ref: "b/lesson.json", learner_id: "ana" } });
    expect(fresh.display_markdown).toContain("### Ton plan d'étude");

    const a = await host.create("a/lesson.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    const b = await host.create("b/lesson.json", "ana");
    await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: idOf(b.presentation) });

    const now = await host.studyPlan("ana", { nowMs: T0 + 60_000 });
    expect(now.next_step).toMatchObject({ action: "continue", arguments: { bundle_ref: "b/lesson.json", learner_id: "ana" } });
    expect(now.in_progress).toEqual([{ bundle_ref: "b/lesson.json", title: "Liaisons", scenes_completed: 1, total_scenes: 2 }]);
    expect(now.next_review_at).toBeGreaterThan(T0 + 60_000);

    const later = await host.studyPlan("ana", { nowMs: T0 + 30 * DAY });
    expect(later.next_step).toMatchObject({ action: "review", tool: "start_review_session", arguments: { learner_id: "ana" } });
    expect(later.due_reviews.find((i) => i.concept_id === "c-a")).toMatchObject({
      concept: "Notion c-a", lesson: { bundle_ref: "a/lesson.json", title: "Atomes" }, scene_id: "s-q",
    });

    const listing = await host.listLessons({ learnerId: "ana" });
    const statusOf = (ref: string) => listing.lessons.find((l) => l.bundle_ref === ref)?.status;
    expect(statusOf("a/lesson.json")).toEqual({ state: "completed", scenes_completed: 1, total_scenes: 1 });
    expect(statusOf("b/lesson.json")).toEqual({ state: "in_progress", scenes_completed: 1, total_scenes: 2 });
    expect((await host.listLessons({ learnerId: "ben" })).lessons.every((l) => l.status?.state === "new")).toBe(true);
  });
});
