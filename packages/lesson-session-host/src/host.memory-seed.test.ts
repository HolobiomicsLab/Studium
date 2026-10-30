// packages/lesson-session-host/src/host.memory-seed.test.ts
//
// RT-3 through the host (W3 review finding, integration item 5): a session starts from the learner's
// cross-lesson FSRS memory, restricted to the lesson's own concepts, so skip-on-mastery reads EFFECTIVE
// mastery (posterior × retrievability, session.ts buildLwgEffectiveMastery) for a learner coming back.
// A concept mastered long ago but not reviewed for a year is taught again instead of skipped; the same
// concept reviewed yesterday is still skipped. Without the memory the session would read the posterior
// alone (0.9 here) and skip both (session.learner-model.test.ts, "skips a concept with no FSRS memory").
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HmacPseudonymProvider } from "@studium/lesson-session/node";
import { defaultConceptState, type LearnerProfile } from "@studium/learner-state";
import { SessionHost } from "./host.js";
import { FileLearnerProfileStore, PROFILE_PSEUDONYM_SCOPE } from "./learner-profile-store.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-02T09:00:00Z");
const SECRET = "memory-seed-test-secret";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "memory-seed-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function write(root: string, ref: string, bundle: object): void {
  mkdirSync(dirname(join(root, ref)), { recursive: true });
  writeFileSync(join(root, ref), JSON.stringify(bundle));
}

const base = (id: string, type: string) => ({
  id, type, title: `Scène ${id}`, objective_refs: ["c"], concept_refs: ["c"], estimated_seconds: 0, adaptation_hooks: [],
});

/** One concept taught by a quiz, a concept scene and an explain_back, with skip-on-mastery pacing. */
const SKIPPING_LESSON = {
  schema_version: "1.4", bundle_id: "lesson-skip", source_plan_id: "p",
  metadata: { title: "Leçon", target: "L1", duration_minutes: 5, language: "fr", discipline: "x" },
  concepts: [{ id: "c", title: "Notion c", description: "d", bloom_level_target: "understand" }],
  scenes: [
    { ...base("i", "intro"), markdown: "Bienvenue." },
    { ...base("q", "quiz"), question: "?", feedback_correct: "ok", feedback_incorrect: "non", hints: [],
      choices: [{ id: "a", text: "A", correct: false }, { id: "b", text: "B", correct: true }] },
    { ...base("k", "concept"), markdown: "Le cours." },
    { ...base("e", "explain_back"), prompt: "Explique.", key_points: [{ id: "kp", text: "t", cues: ["x"] }],
      model_explanation: "m", rubric: { completeness: 1, evidence_quality: 1, tone: 1 } },
  ],
  rules: [], validated_by: "Prof. Test", validated_at: "2026-10-01T00:00:00Z",
  learning_workflow_graph: { schema_version: "1.0", course_id: "k", edges: [],
    nodes: [{ id: "concept:c", node_kind: "concept", title: "c", bloom_level: "understand" }] },
  universes: { active: "baseline", variants: [{ id: "baseline", description: "d", decisions: { pacing: "skip_on_mastery" } }] },
};

/** A durable data folder holding a learner profile: concept c mastered on the posterior (alpha 9,
 * beta 1, three graded attempts), last reviewed at `lastReviewedMs` with `stability` days, and the
 * memory of a concept of another lesson. */
async function dataDirWithProfile(lastReviewedMs: number, stability: number): Promise<string> {
  vi.stubEnv("STUDIUM_PSEUDO_SECRET", SECRET);
  const dataDir = tmp();
  const pseudonym = await new HmacPseudonymProvider(SECRET).get("ana", PROFILE_PSEUDONYM_SCOPE);
  const memory = (conceptId: string) => ({
    concept_id: conceptId, stability, difficulty: 5, last_reviewed_at: lastReviewedMs, reps: 2, lapses: 0,
  });
  const profile: LearnerProfile = {
    pseudonym, schema_version: "1.0",
    concept_states: { c: { ...defaultConceptState("c"), alpha: 9, beta: 1, total_attempts: 3, total_correct: 3 } },
    completed_lessons: [], concept_memory: { c: memory("c"), elsewhere: memory("elsewhere") },
    updated_at: new Date(lastReviewedMs).toISOString(),
  };
  await new FileLearnerProfileStore(dataDir).save(profile);
  return dataDir;
}

async function afterTheIntro(dataDir: string) {
  const bundles = tmp();
  write(bundles, "L.json", SKIPPING_LESSON);
  const host = new SessionHost({ bundlesRoot: bundles, dataDir, live: false, clock: { now: () => new Date(T0).toISOString() } });
  const started = await host.create("L.json", "ana");
  const memory = host.getState(started.sessionId).concept_memory;
  const transition = await host.respond(started.sessionId, { kind: "ack" });
  return { memory, transition };
}

describe("RT-3 — a session starts from the learner's FSRS memory of its own concepts", () => {
  it("does not skip a concept mastered but last reviewed a year ago: its recall has decayed", async () => {
    const { memory, transition } = await afterTheIntro(await dataDirWithProfile(T0 - 365 * DAY, 2));
    // The profile's memory of the lesson's concept, and of no other lesson's concept.
    expect(Object.keys(memory ?? {})).toEqual(["c"]);
    expect(memory?.["c"]).toMatchObject({ reps: 2, last_reviewed_at: T0 - 365 * DAY });
    expect(transition.navigation?.kind).toBe("advance");
    expect(transition.kind === "next" ? transition.presentation.scene.id : null).toBe("q");
  });

  it("still skips the same concept reviewed yesterday with a long stability", async () => {
    const { transition } = await afterTheIntro(await dataDirWithProfile(T0 - DAY, 30));
    expect(transition.navigation?.kind).toBe("skip_mastered");
    expect(transition.navigation?.skipped_scene_ids).toEqual(["q", "k"]);
  });
});
