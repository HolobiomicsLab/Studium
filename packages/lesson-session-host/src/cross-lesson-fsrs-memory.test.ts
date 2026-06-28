// CROSS-LESSON FSRS memory: a concept reviewed in a completed lesson is REMEMBERED (its FSRS retention
// state persists on the learner profile) so spaced-repetition routing surfaces it as DUE later — even
// from a different lesson / no live session. host.dueReinforcements reads the persisted concept_memory.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost, dueReinforcementTargetsFromMemory } from "./host.js";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);

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

const mem = (cid: string, last: number | null, stability: number, reps: number) =>
  ({ concept_id: cid, stability, difficulty: 5, last_reviewed_at: last, reps, lapses: 0 });

describe("dueReinforcementTargetsFromMemory (pure cross-lesson router)", () => {
  it("returns mastered+due concepts most-urgent-first, excluding unmastered + fresh", () => {
    const memory = {
      "c-decayed": mem("c-decayed", t0, 2, 1),   // reviewed long ago, low stability → due at +30d
      "c-fresh": mem("c-fresh", t0 + 29 * DAY, 50, 1), // just reviewed, high stability → not due
      "c-weak": mem("c-weak", t0, 2, 1),          // due BUT unmastered → excluded
    };
    const mastery = { "c-decayed": 0.9, "c-fresh": 0.9, "c-weak": 0.3 };
    const out = dueReinforcementTargetsFromMemory(memory, mastery, t0 + 30 * DAY);
    const ids = out.map((t) => t.concept_id);
    expect(ids).toContain("c-decayed");
    expect(ids).not.toContain("c-fresh");
    expect(ids).not.toContain("c-weak");
    expect(out[0]!.retrievability).toBeLessThan(1);
  });

  it("empty memory → no targets", () => {
    expect(dueReinforcementTargetsFromMemory({}, {}, t0)).toEqual([]);
  });
});

describe("host.dueReinforcements — persisted across a completed lesson", () => {
  it("a concept mastered+reviewed in a completed lesson becomes DUE later (cross-lesson, no live session)", async () => {
    const d = mkdtempSync(join(tmpdir(), "xfsrs-"));
    writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false });

      // a learner with no history → nothing due
      expect(await host.dueReinforcements("learner-1", t0 + 30 * DAY)).toEqual([]);

      // complete lesson A (one correct quiz answer → mastery 0.714, FSRS reps=1) → memory persisted
      const a = await host.create("A.json", "learner-1");
      const tr = await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect(tr.kind).toBe("complete");

      // right after completion (≈now) the concept is fresh → not yet due
      const fresh = await host.dueReinforcements("learner-1"); // default nowMs ≈ wall clock
      expect(fresh.find((t) => t.concept_id === "c-shared")).toBeUndefined();

      // far in the future its recall has decayed → DUE, surfaced WITHOUT any live session
      const due = await host.dueReinforcements("learner-1", Date.UTC(2035, 0, 1));
      expect(due.map((t) => t.concept_id)).toContain("c-shared");
      expect(due[0]!.retrievability).toBeLessThan(1);

      // per-learner: another learner who never did A has nothing due
      expect(await host.dueReinforcements("learner-2", Date.UTC(2035, 0, 1))).toEqual([]);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("completing a LATER lesson that only DECLARES (warm-seeds) a shared concept does NOT clobber its memory", async () => {
    const d = mkdtempSync(join(tmpdir(), "xfsrs-"));
    writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
    // lesson B DECLARES c-shared in its `concepts` (so it warm-seeds into B's state) but its only scene
    // answers a DIFFERENT concept — c-shared is never re-answered in B.
    const bBundle = quizBundle("lesson-B", "c-localB");
    bBundle.concepts.push({ id: "c-shared", title: "C", description: "d", bloom_level_target: "understand" });
    writeFileSync(join(d, "B.json"), JSON.stringify(bBundle));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false });
      // complete A (answers c-shared) → c-shared is due in the far future
      const a = await host.create("A.json", "learner-1");
      await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" });
      expect((await host.dueReinforcements("learner-1", Date.UTC(2035, 0, 1))).map((t) => t.concept_id)).toContain("c-shared");

      // complete B (answers ONLY c-localB; c-shared warm-seeded but unanswered)
      const b = await host.create("B.json", "learner-1");
      await host.respond(b.sessionId, { kind: "quiz_choice", choiceId: "a" });

      // c-shared's memory must SURVIVE B's completion (the merge skips the reps:0 unseen replay)
      const due = (await host.dueReinforcements("learner-1", Date.UTC(2035, 0, 1))).map((t) => t.concept_id);
      expect(due).toContain("c-shared");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
