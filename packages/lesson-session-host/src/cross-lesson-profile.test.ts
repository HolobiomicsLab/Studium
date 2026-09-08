// CROSS-LESSON warm start at the host level: a concept worked in lesson A starts WARM in lesson B
// (its mastery/attempts carry via the learner-level profile), while an unrelated concept stays cold and
// a different learner is unaffected. In-memory profile store persists across this host's sessions.
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHost } from "./host.js";

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

describe("cross-lesson learner profile — warm start across bundles", () => {
  it("a concept worked in lesson A starts WARM in lesson B; unrelated stays cold; other learners unaffected", async () => {
    const d = mkdtempSync(join(tmpdir(), "xlesson-"));
    writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
    writeFileSync(join(d, "B.json"), JSON.stringify(quizBundle("lesson-B", "c-shared")));
    writeFileSync(join(d, "C.json"), JSON.stringify(quizBundle("lesson-C", "c-unrelated")));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false });

      // a FRESH learner starting B has c-shared COLD (never worked it)
      const fresh = await host.create("B.json", "learner-1");
      expect(host.getState(fresh.sessionId).concept_states["c-shared"]).toBeUndefined();

      // learner-2 completes A (answers the c-shared quiz) -> merged into the learner profile on complete
      const a = await host.create("A.json", "learner-2");
      const t = await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" }); // last scene -> complete
      expect(t.kind).toBe("complete");

      // ...now learner-2 starts B (same concept) -> c-shared is SEEDED warm (the attempt carries over)
      const b = await host.create("B.json", "learner-2");
      const csB = host.getState(b.sessionId).concept_states["c-shared"];
      expect(csB).toBeDefined();
      expect(csB!.total_attempts).toBeGreaterThanOrEqual(1); // warm — carried from lesson A

      // ...an UNRELATED concept (lesson C) is NOT seeded — no cross-contamination
      const c = await host.create("C.json", "learner-2");
      expect(host.getState(c.sessionId).concept_states["c-unrelated"]).toBeUndefined();

      // ...and learner-3 (who never did A) is still cold on B — the profile is per-learner
      const other = await host.create("B.json", "learner-3");
      expect(host.getState(other.sessionId).concept_states["c-shared"]).toBeUndefined();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("RGPD: forget() erases the cross-lesson profile too (a later session starts cold again)", async () => {
    const d = mkdtempSync(join(tmpdir(), "xlesson-"));
    writeFileSync(join(d, "A.json"), JSON.stringify(quizBundle("lesson-A", "c-shared")));
    writeFileSync(join(d, "B.json"), JSON.stringify(quizBundle("lesson-B", "c-shared")));
    try {
      const host = new SessionHost({ bundlesRoot: d, live: false });
      const a = await host.create("A.json", "learner-9");
      await host.respond(a.sessionId, { kind: "quiz_choice", choiceId: "a" }); // complete -> profile merged
      // sanity: warm before forget
      const warm = await host.create("B.json", "learner-9");
      expect(host.getState(warm.sessionId).concept_states["c-shared"]).toBeDefined();
      await host.forget(warm.sessionId); // RGPD erase -> also drops the cross-lesson profile
      // a NEW session for the same learner is cold again (profile gone)
      const after = await host.create("B.json", "learner-9");
      expect(host.getState(after.sessionId).concept_states["c-shared"]).toBeUndefined();
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
