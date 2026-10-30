// packages/lesson-session-host/src/host.self-rating.test.ts
//
// L-9 (RFR-10, CC-8), host part: a self-rating schedules every concept the rated scene teaches (its
// concept_refs), not only the first one; a rating asked for before the server stopped can still be
// given after it restarts (the request is saved with the lesson state); and a rating whose request was
// lost with an older server says so, distinctly from a rating nobody asked for.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionHost } from "./host.js";

const T0 = Date.parse("2026-11-02T09:00:00Z");
const dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "self-rating-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}
const fixedClock = { now: () => new Date(T0).toISOString() };

/** An explain_back scene on two concepts — no judge offline, so its answer asks for a self-rating —
 * then a quiz. */
function lesson() {
  const scenes = [
    { id: "s-e", type: "explain_back", title: "Scène s-e", objective_refs: [], concept_refs: ["c-signe", "c-lobe"],
      estimated_seconds: 30, adaptation_hooks: [], prompt: "Explique pourquoi le signe change.",
      key_points: [{ id: "kp", text: "Le signe suit la phase.", cues: ["signe"] }], model_explanation: "Modèle.",
      rubric: { completeness: 1, evidence_quality: 1, tone: 1 } },
    { id: "s-q", type: "quiz", title: "Scène s-q", objective_refs: [], concept_refs: ["c-autre"], estimated_seconds: 30,
      adaptation_hooks: [], question: "Question ?", choices: [{ id: "a", text: "Juste", correct: true }, { id: "b", text: "Faux", correct: false }],
      feedback_correct: "oui", feedback_incorrect: "non", hints: [] },
  ];
  return {
    schema_version: "1.4", bundle_id: "lesson-e", source_plan_id: "p",
    metadata: { title: "Leçon E", target: "L1", duration_minutes: 5, language: "fr", discipline: "chimie" },
    concepts: ["c-signe", "c-lobe", "c-autre"].map((c) => ({ id: c, title: `Notion ${c}`, description: "d", bloom_level_target: "understand" })),
    scenes, rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  };
}

/** Every file named `name` under `dir`, at any depth. */
function filesNamed(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return filesNamed(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

describe("L-9 — a self-rating applies to every concept of the rated scene", () => {
  it("returns the lesson's updated review plan even before the final scene", async () => {
    const bundles = tmp();
    write(bundles, "E.json", lesson());
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock: fixedClock });
    const started = await host.create("E.json", "ana");
    await host.respond(started.sessionId, { kind: "reply", text: "Le signe suit la phase." });
    const rated = await host.rateRecall(started.sessionId, "s-e", "good");
    expect(rated.review_plan).toEqual({ next_due_at: rated.next_review_at, next_due_date: rated.next_review_date,
      concepts: ["c-signe", "c-lobe"],
    });
  });

  it("schedules both concepts of a two-concept scene, and says which", async () => {
    const bundles = tmp();
    write(bundles, "E.json", lesson());
    const host = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: null, clock: fixedClock });
    const s = await host.create("E.json", "ana");
    const t = await host.respond(s.sessionId, { kind: "reply", text: "Le signe change avec la phase." });
    expect(t.self_rating).toMatchObject({ requested: true, scene_id: "s-e" });
    const rated = await host.rateRecall(s.sessionId, "s-e", "good");
    expect(rated.concept_ids).toEqual(["c-signe", "c-lobe"]);
    expect(rated.concept_id).toBe("c-signe");
    expect(host.reviewQueue(s.sessionId).map((item) => item.concept_id).sort()).toEqual(["c-lobe", "c-signe"]);
    const status = await host.reinforcementStatusForLearner("ana", T0 + 60 * 86_400_000);
    expect(status.unmeasured.map((item) => item.concept_id).sort()).toEqual(["c-lobe", "c-signe"]);
  });
});

describe("L-9 — a pending self-rating survives a server restart", () => {
  it("is accepted by the resumed session of the next server, once", async () => {
    const bundles = tmp();
    const data = tmp();
    write(bundles, "E.json", lesson());
    const before = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock: fixedClock });
    const s = await before.create("E.json", "ana");
    await before.respond(s.sessionId, { kind: "reply", text: "Le signe change avec la phase." });
    // The server stops before the learner rates: a new one resumes the lesson.
    const after = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock: fixedClock });
    const resumed = await after.create("E.json", "ana");
    expect(resumed.resume).toMatchObject({ kind: "resumed" });
    const rated = await after.rateRecall(resumed.sessionId, "s-e", "hard");
    expect(rated).toMatchObject({ scene_id: "s-e", concept_ids: ["c-signe", "c-lobe"], grade: "hard" });
    await expect(after.rateRecall(resumed.sessionId, "s-e", "good")).rejects.toThrow(/no self-rating was requested for scene "s-e"/);
    // Rated, the request is gone from the saved state too: a third server does not ask again.
    const third = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock: fixedClock });
    const again = await third.create("E.json", "ana");
    await expect(third.rateRecall(again.sessionId, "s-e", "good")).rejects.toThrow(/no self-rating was requested for scene "s-e"/);
  });

  it("a request an older server kept in memory only is reported as expired, not as never asked", async () => {
    const bundles = tmp();
    const data = tmp();
    write(bundles, "E.json", lesson());
    const before = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock: fixedClock });
    const s = await before.create("E.json", "ana");
    await before.respond(s.sessionId, { kind: "reply", text: "Le signe change avec la phase." });
    // The state as a server before L-9 saved it: no self_rating_requests field.
    const [stateFile] = filesNamed(data, /^state-.*\.json$/);
    const state = JSON.parse(readFileSync(stateFile!, "utf8")) as Record<string, unknown>;
    expect(state["self_rating_requests"]).toBeDefined();
    delete state["self_rating_requests"];
    writeFileSync(stateFile!, JSON.stringify(state));
    const after = new SessionHost({ bundlesRoot: bundles, live: false, dataDir: data, clock: fixedClock });
    const resumed = await after.create("E.json", "ana");
    await expect(after.rateRecall(resumed.sessionId, "s-e", "good")).rejects.toThrow(/expired with the previous server process/);
  });
});
