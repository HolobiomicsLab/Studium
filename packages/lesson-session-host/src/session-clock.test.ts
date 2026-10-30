// packages/lesson-session-host/src/session-clock.test.ts
//
// L-1 (RFR-01, R-en-02, CC-3): a session started with now_ms stamps its answers, its self-ratings and
// the FSRS memory they move at now_ms plus the time elapsed since it started — so a review played « a
// week later » is recorded a week later, its next review falls after that, and the plan advances.
// now_ms is an integer epoch with a four-digit year, refused otherwise with one readable line.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";
import { NOW_MS_MAX, NowMsSchema, OffsetClock, checkNowMs } from "./session-clock.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");

const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "session-clock-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}

const base = (id: string, type: string, concept: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: [], concept_refs: [concept], estimated_seconds: 30, adaptation_hooks: [],
});
const quiz = (id: string, concept: string) => ({
  ...base(id, "quiz", concept), question: `Question ${id} ?`,
  choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
  feedback_correct: "oui", feedback_incorrect: "non", hints: [],
});
const explainBack = (id: string, concept: string) => ({
  ...base(id, "explain_back", concept), prompt: "Explique pourquoi.",
  key_points: [{ id: "kp", text: "un point", cues: ["signe"] }], model_explanation: "modèle",
  rubric: { completeness: 1, evidence_quality: 1, tone: 1 },
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
const idOf = (presentation: { scene: unknown }, text = "Juste"): string =>
  (presentation.scene as { choices: Array<{ id: string; text: string }> }).choices.find((c) => c.text === text)!.id;

/** The wall clock of a harness replaying days in minutes: it barely moves. */
function wallClock(start: number) {
  let now = start;
  return { clock: { now: () => new Date(now).toISOString() }, advance: (ms: number) => { now += ms; } };
}

describe("OffsetClock", () => {
  it("starts at its anchor and moves with the clock under it", () => {
    const { clock, advance } = wallClock(T0);
    const offset = new OffsetClock(T0 + 7 * DAY, clock);
    expect(offset.now()).toBe(new Date(T0 + 7 * DAY).toISOString());
    advance(90_000);
    expect(offset.now()).toBe(new Date(T0 + 7 * DAY + 90_000).toISOString());
  });
});

describe("now_ms is an integer epoch in a Date-safe range", () => {
  it.each([1.5, -1, NOW_MS_MAX + 1, 1e16, Number.NaN, Number.POSITIVE_INFINITY])("refuses %s", (value) => {
    expect(() => checkNowMs(value)).toThrow(/^now_ms must be an integer epoch in milliseconds/);
    expect(NowMsSchema.safeParse(value).success).toBe(false);
  });
  it("accepts an integer epoch", () => {
    expect(checkNowMs(T0)).toBe(T0);
    expect(NowMsSchema.parse(NOW_MS_MAX)).toBe(NOW_MS_MAX);
  });
  it("is refused by every host entry point before anything runs", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-q")]));
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null });
    await expect(host.create("A.json", "ana", { nowMs: 1e16 })).rejects.toThrow(/now_ms must be an integer/);
    await expect(host.startReview("ana", { nowMs: 1.5 })).rejects.toThrow(/now_ms must be an integer/);
    await expect(host.studyPlan("ana", { nowMs: -5 })).rejects.toThrow(/now_ms must be an integer/);
    await expect(host.reinforcementStatusForLearner("ana", 1e16)).rejects.toThrow(/now_ms must be an integer/);
  });
});

describe("a session started with now_ms runs on a clock anchored there (L-1)", () => {
  it("a review played at +7 days stamps its answer, its rating and its memory at +7 days, and the plan advances", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-q"), explainBack("s-e", "c-e")]));
    const { clock, advance } = wallClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });

    // Day 0: the lesson, a right answer to the quiz and a self-rated explanation.
    const a = await host.create("A.json", "ana");
    await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: idOf(a.presentation) });
    const explained = await host.respond(a.sessionId, { kind: "reply", text: "Le signe change." });
    await host.rateRecall(a.sessionId, explained.self_rating!.scene_id, "good");
    await host.close(a.sessionId);

    // A week later for the learner, a minute later for the wall clock.
    advance(60_000);
    const weekLater = T0 + 7 * DAY;
    const before = await host.studyPlan("ana", { nowMs: weekLater });
    expect([...before.due_reviews, ...before.relearn, ...before.unmeasured_reviews].map((i) => i.concept_id).sort())
      .toEqual(["c-e", "c-q"]);

    const review = await host.startReview("ana", { nowMs: weekLater });
    if (review.status !== "started") throw new Error(`expected a review, got ${review.status}`);
    let presentation: { scene: unknown } = review.presentation;
    for (let guard = 0; guard < 4; guard += 1) {
      const scene = presentation.scene as { type: string };
      const t = scene.type === "quiz"
        ? await host.respond(review.sessionId, { kind: "quiz_choice", choiceId: idOf(presentation) })
        : await host.respond(review.sessionId, { kind: "reply", text: "Le signe change entre les lobes." });
      if (t.self_rating) {
        const rated = await host.rateRecall(review.sessionId, t.self_rating.scene_id, "good");
        expect(rated.next_review_at).toBeGreaterThan(weekLater);
      }
      if (t.kind === "complete") break;
      presentation = (t as unknown as { presentation: { scene: unknown } }).presentation;
    }
    // The answers are stamped at the session's instant, never at the wall clock's.
    const stamps = host.getState(review.sessionId).history.map((h) => Date.parse(h.timestamp));
    expect(stamps.length).toBeGreaterThan(0);
    for (const stamp of stamps) expect(stamp).toBeGreaterThanOrEqual(weekLater);
    await host.close(review.sessionId);

    // The review moved the schedule past the instant it was played at: nothing is due an hour later.
    const after = await host.studyPlan("ana", { nowMs: weekLater + 3_600_000 });
    expect([...after.due_reviews, ...after.relearn, ...after.unmeasured_reviews]).toEqual([]);
    expect(after.next_review_at).toBeGreaterThan(weekLater);
    expect(after.next_step.action).not.toBe("review");
  });

  it("a lesson started with now_ms stamps its answers there too", async () => {
    const bundles = tmp();
    write(bundles, "A.json", lesson("lesson-A", [quiz("s-q", "c-q"), quiz("s-q2", "c-q")]));
    const { clock } = wallClock(T0);
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock });
    const later = T0 + 30 * DAY;
    const s = await host.create("A.json", "ana", { nowMs: later });
    await host.respond(s.sessionId, { kind: "quiz_choice", choiceId: idOf(s.presentation) });
    const [answer] = host.getState(s.sessionId).history;
    expect(Date.parse(answer!.timestamp)).toBeGreaterThanOrEqual(later);
    // Session reads default to the session's own clock, not the wall clock's.
    expect(host.reviewQueue(s.sessionId)).toEqual([expect.objectContaining({ concept_id: "c-q", last_reviewed_at: expect.any(Number) })]);
    expect(host.reviewQueue(s.sessionId)[0]!.last_reviewed_at).toBeGreaterThanOrEqual(later);
  });
});
