// SEED the per-session FSRS replay from the learner profile's accumulated concept_memory, so a concept
// re-reviewed in a LATER lesson ACCUMULATES stability (A+B) rather than restarting from scratch (B-only).
// Dedup rule: the seed already accounts for every answer up to its last_reviewed_at, so on a resume the
// LOADED prior history (events at/before that instant) is NOT re-folded; a genuinely NEW answer (strictly
// later) IS folded and legitimately accumulates — re-answering a scene later is a real retrieval, not a
// double count. Bound: a non-monotonic clock (cross-machine skew / same-ms tie) makes a genuine new
// answer look already-folded → it is conservatively skipped (bounded under-count, self-heals; never a
// double count). See memoryFromHistory.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, conceptMemoryFromState } from "./host.js";
import { defaultConceptState, type ConceptMemoryState, type LearnerState } from "@studium/learner-state";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);

function answer(conceptId: string, correct: boolean, tMs: number, scene = "s-q"): unknown {
  return {
    timestamp: new Date(tMs).toISOString(),
    scene_id: scene,
    signal: {
      kind: "answer_submitted", concept_id: conceptId, scene_id: scene,
      correct, time_ms: 1000, hint_count: 0, difficulty: 0.5,
    },
    decision: { kind: "advance" },
  };
}

function stateWith(conceptId: string, history: unknown[]): LearnerState {
  return {
    lesson_id: "L", schema_version: "1.0",
    concept_states: { [conceptId]: defaultConceptState(conceptId) },
    scenes_completed: [], scenes_replayed: {}, history,
  } as unknown as LearnerState;
}

const seedMem = (cid: string, over: Partial<ConceptMemoryState> = {}): ConceptMemoryState => ({
  concept_id: cid, stability: 6, difficulty: 5, last_reviewed_at: t0, reps: 1, lapses: 0, ...over,
});

describe("conceptMemoryFromState(state, seed) — seeded cross-lesson FSRS replay", () => {
  it("with NO seed, replays the session from scratch (back-compat: unchanged behavior)", () => {
    const state = stateWith("c", [answer("c", true, t0)]);
    const out = conceptMemoryFromState(state);
    expect(out["c"]!.reps).toBe(1);
    // explicit-undefined seed is identical to omitting it
    expect(conceptMemoryFromState(state, undefined)["c"]!.reps).toBe(1);
  });

  it("seeds the replay → a later answer ACCUMULATES (reps 1→2, stability grows beyond the seed)", () => {
    const seed = seedMem("c", { stability: 6, reps: 1, last_reviewed_at: t0 });
    // the learner reviews c again 40 days later (a genuine spaced review, after the seed's last review)
    const state = stateWith("c", [answer("c", true, t0 + 40 * DAY)]);
    const out = conceptMemoryFromState(state, { c: seed });
    expect(out["c"]!.reps).toBe(2);                       // accumulated, NOT reset to 1
    expect(out["c"]!.stability).toBeGreaterThan(6);       // a spaced successful review GROWS stability
    expect(out["c"]!.last_reviewed_at).toBe(t0 + 40 * DAY);
  });

  it("a LOADED prior answer (at/before the seed's last review) is NOT re-folded; only the new one accumulates", () => {
    const seed = seedMem("c", { reps: 1, last_reviewed_at: t0 });
    // history still holds the ORIGINAL t0 answer (the one already baked into the seed) PLUS one new review
    const state = stateWith("c", [answer("c", true, t0), answer("c", true, t0 + 40 * DAY)]);
    const out = conceptMemoryFromState(state, { c: seed });
    expect(out["c"]!.reps).toBe(2); // seed(1) + ONLY the post-seed answer — the t0 replay is skipped, not re-folded
  });

  it("a resume whose history holds ONLY already-folded answers (no NEW answer) is a no-op on the seed", () => {
    const seed = seedMem("c", { reps: 3, stability: 20, last_reviewed_at: t0 });
    const state = stateWith("c", [answer("c", true, t0 - DAY), answer("c", true, t0)]); // both ≤ seed.last
    const out = conceptMemoryFromState(state, { c: seed });
    expect(out["c"]!.reps).toBe(3);          // unchanged
    expect(out["c"]!.stability).toBe(20);    // unchanged
  });

  it("CLOCK-SKEW / same-ms bound: a genuine new answer at/before the seed's last review is conservatively skipped", () => {
    // The seed last reviewed at t0; a real new answer lands at t0 (tie) and at t0-1ms (a lagging clock).
    // Both are <= seededThrough, indistinguishable from already-folded events → skipped (bounded under-count).
    const seed = seedMem("c", { reps: 1, stability: 6, last_reviewed_at: t0 });
    const tie = conceptMemoryFromState(stateWith("c", [answer("c", true, t0)]), { c: seed });
    expect(tie["c"]!.reps).toBe(1);          // skipped — seed preserved, never regressed
    const skew = conceptMemoryFromState(stateWith("c", [answer("c", true, t0 - 1)]), { c: seed });
    expect(skew["c"]!.reps).toBe(1);
    // …and it self-heals: a later in-order answer DOES fold.
    const heal = conceptMemoryFromState(stateWith("c", [answer("c", true, t0 - 1), answer("c", true, t0 + 10 * DAY)]), { c: seed });
    expect(heal["c"]!.reps).toBe(2);
  });

  it("a MALFORMED seed (reps>=1 but stability<=0 / null last) is not a usable anchor → replays from scratch", () => {
    // would otherwise trip reviewMemory's re-init branch and silently reset reps→1 mid-fold.
    const bad = { concept_id: "c", stability: 0, difficulty: 5, last_reviewed_at: null, reps: 4, lapses: 0 };
    const state = stateWith("c", [answer("c", true, t0), answer("c", true, t0 + 10 * DAY)]);
    const out = conceptMemoryFromState(state, { c: bad });
    expect(out["c"]!.reps).toBe(2); // both session answers folded from a clean default (predictable), not a half-reset
  });

  it("MULTI-LESSON chain (A→B→C) keeps accumulating: reps 1→2→3 as each lesson seeds from the prior", () => {
    // emulate three completions, each replaying ONE new answer seeded from the prior profile memory
    const a = conceptMemoryFromState(stateWith("c", [answer("c", true, t0)]), undefined);
    expect(a["c"]!.reps).toBe(1);
    const b = conceptMemoryFromState(stateWith("c", [answer("c", true, t0 + 30 * DAY)]), { c: a["c"]! });
    expect(b["c"]!.reps).toBe(2);
    const c = conceptMemoryFromState(stateWith("c", [answer("c", true, t0 + 60 * DAY)]), { c: b["c"]! });
    expect(c["c"]!.reps).toBe(3);
    expect(c["c"]!.stability).toBeGreaterThan(b["c"]!.stability); // compounding across 3 lessons
  });

  it("a concept absent from the seed folds from scratch (other concepts unaffected)", () => {
    const state = stateWith("c-new", [answer("c-new", true, t0 + DAY)]);
    const out = conceptMemoryFromState(state, { "c-other": seedMem("c-other") });
    expect(out["c-new"]!.reps).toBe(1);
  });
});

// ── Host wiring: completing two DISTINCT lessons that share a concept ACCUMULATES in the persisted profile.
function quizBundle(id: string, conceptId: string) {
  return {
    schema_version: "1.4", bundle_id: id, source_plan_id: "p",
    metadata: { title: id, target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
    concepts: [{ id: conceptId, title: "C", description: "d", bloom_level_target: "understand" }],
    scenes: [
      { id: "s-q", type: "quiz", title: "Q", objective_refs: [], concept_refs: [conceptId], estimated_seconds: 0, adaptation_hooks: [],
        question: "?", choices: [{ id: "a", text: "A", correct: true }, { id: "b", text: "B", correct: false }], feedback_correct: "y", feedback_incorrect: "n", hints: [] },
    ],
    rules: [], validated_by: "teacher", validated_at: "2026-06-28T00:00:00Z",
  };
}

function readPersistedProfile(dataDir: string): { concept_memory?: Record<string, ConceptMemoryState> } | null {
  // FileLearnerProfileStore writes <dataDir>/<pseudonym>/profile.json
  for (const ent of readdirSync(dataDir)) {
    const p = join(dataDir, ent, "profile.json");
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  }
  return null;
}

describe("host completion-merge — durable cross-lesson FSRS accumulation", () => {
  it("two distinct lessons reviewing the same concept → persisted reps accumulates to 2 (not B-only 1)", async () => {
    const prevDataDir = process.env["STUDIUM_DATA_DIR"];
    const d = mkdtempSync(join(tmpdir(), "seed-"));
    const dataDir = mkdtempSync(join(tmpdir(), "seed-data-"));
    process.env["STUDIUM_DATA_DIR"] = dataDir;
    try {
      writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
      writeFileSync(join(d, "B.json"), JSON.stringify(quizBundle("lesson-B", "c-shared")));
      const host = new SessionHost({ bundlesRoot: d, live: false });

      const a = await host.create("A.json", "learner-1");
      expect((await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" })).kind).toBe("complete");
      expect(readPersistedProfile(dataDir)?.concept_memory?.["c-shared"]?.reps).toBe(1);

      const b = await host.create("B.json", "learner-1");
      expect((await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: "a" })).kind).toBe("complete");
      // SEEDED: B's review builds on A's persisted memory → reps 2 (a real second retrieval), not reset to 1.
      expect(readPersistedProfile(dataDir)?.concept_memory?.["c-shared"]?.reps).toBe(2);
    } finally {
      if (prevDataDir === undefined) delete process.env["STUDIUM_DATA_DIR"];
      else process.env["STUDIUM_DATA_DIR"] = prevDataDir;
      rmSync(d, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("RESUMING and re-answering the SAME lesson adds exactly ONE rep each time (a genuine re-retrieval; the loaded history is never re-folded)", async () => {
    // The live resume path: host.create rebuilds a fresh LessonSession at scene 0, so the learner
    // RE-ANSWERS. That new answer (a later timestamp) is a real retrieval and accumulates; the loaded
    // prior answer is skipped, so reps grows by EXACTLY 1 per re-completion (never doubles).
    const prevDataDir = process.env["STUDIUM_DATA_DIR"];
    const d = mkdtempSync(join(tmpdir(), "seed-"));
    const dataDir = mkdtempSync(join(tmpdir(), "seed-data-"));
    process.env["STUDIUM_DATA_DIR"] = dataDir;
    try {
      writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
      const host = new SessionHost({ bundlesRoot: d, live: false });
      const reps = async () => readPersistedProfile(dataDir)?.concept_memory?.["c-shared"]?.reps;

      const a1 = await host.create("A.json", "learner-1");
      await host.respond(a1.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect(await reps()).toBe(1);

      const a2 = await host.create("A.json", "learner-1"); // resume → re-presents scene 0
      await host.respond(a2.sessionId, { kind: "quiz_choice", choiceId: "a" }); // genuine re-answer
      expect(await reps()).toBe(2); // +1 (NOT 3 — the loaded t1 answer was not re-folded)

      const a3 = await host.create("A.json", "learner-1");
      await host.respond(a3.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect(await reps()).toBe(3); // +1 again
    } finally {
      if (prevDataDir === undefined) delete process.env["STUDIUM_DATA_DIR"];
      else process.env["STUDIUM_DATA_DIR"] = prevDataDir;
      rmSync(d, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
