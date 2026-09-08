// FSRS-AS-ROUTER: promote FSRS from a readout (reviewQueue lists every due concept) to a ROUTER that
// makes ONE selection decision — the single most-urgent concept to reinforce, and the bundle scene
// that addresses it. Pure functions over a replayed answer history; `nowMs` injected for determinism.
import { describe, it, expect } from "vitest";
import {
  defaultLearnerState,
  defaultConceptState,
  type LearnerState,
  type ConceptState,
  type Signal,
  type Decision,
} from "@studium/learner-state";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import {
  conceptMemoryFromState,
  nextReinforcementFromState,
  reinforcementSceneFromState,
} from "./host.js";
// Authoritative scheduler (relative file import; no @studium/adaptation-engine package dep — same
// approach as host-fsrs.parity.test.ts). Pins the host's INLINED reinforcement mirror against it.
import {
  defaultMemoryState as engineDefaultMemory,
  reviewMemory as engineReviewMemory,
  gradeFromAnswer as engineGrade,
  nextReinforcement as engineNextReinforcement,
} from "../../adaptation-engine/src/fsrs.js";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);
const NOOP_DECISION: Decision = {
  next_action: { kind: "advance_to_next_scene" },
  rule_id: null,
  explanation_short: null,
  modulator: null,
};

/** A LearnerState with a graded answer history per concept + an explicit mastery (alpha/beta). */
function stateWith(
  concepts: Array<{ id: string; mastery: number; answers: Array<{ correct: boolean; hint_count: number; atMs: number }> }>,
): LearnerState {
  const s = defaultLearnerState("lesson-fsrs");
  for (const c of concepts) {
    const cs: ConceptState = defaultConceptState(c.id);
    // mastery = alpha/(alpha+beta); pick alpha/beta to hit the target mastery.
    cs.alpha = c.mastery * 10;
    cs.beta = (1 - c.mastery) * 10;
    s.concept_states[c.id] = cs;
    for (const a of c.answers) {
      const signal: Signal = {
        kind: "answer_submitted", concept_id: c.id, scene_id: "scn",
        correct: a.correct, time_ms: 1000, hint_count: a.hint_count, difficulty: 0.5,
      };
      s.history.push({ timestamp: new Date(a.atMs).toISOString(), scene_id: "scn", signal, decision: NOOP_DECISION });
    }
  }
  return s;
}

const bundleWithScenes = (scenes: Array<{ id: string; concept_refs: string[]; type?: string }>): LessonBundle =>
  ({ scenes } as unknown as LessonBundle);

describe("FSRS-as-router — nextReinforcementFromState", () => {
  it("routes to the single most-urgent due+mastered concept (not a list)", () => {
    // two mastered concepts reviewed once at t0; 30 days later both are overdue
    const state = stateWith([
      { id: "c-fit", mastery: 0.9, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
      { id: "c-units", mastery: 0.7, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
    ]);
    const target = nextReinforcementFromState(state, t0 + 30 * DAY);
    expect(target).not.toBeNull();
    // equal decay ⇒ higher mastery wins the priority → c-fit is THE decision
    expect(target?.concept_id).toBe("c-fit");
    expect(target?.retrievability).toBeLessThan(1);
    expect(target?.retrievability).toBeGreaterThan(0);
  });

  it("returns null when freshly reviewed (nothing decayed yet)", () => {
    const state = stateWith([
      { id: "c-fit", mastery: 0.9, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
    ]);
    expect(nextReinforcementFromState(state, t0)).toBeNull();
  });

  it("excludes unmastered concepts (reinforcement is for consolidation, not first learning)", () => {
    const state = stateWith([
      { id: "c-weak", mastery: 0.3, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
    ]);
    expect(nextReinforcementFromState(state, t0 + 30 * DAY)).toBeNull();
  });

  it("ignores concepts with no graded answers (reps=0)", () => {
    const state = stateWith([{ id: "c-seen-never-answered", mastery: 0.9, answers: [] }]);
    expect(nextReinforcementFromState(state, t0 + 30 * DAY)).toBeNull();
  });
});

describe("FSRS-as-router — conceptMemoryFromState", () => {
  it("replays each concept's answer history into a memory map", () => {
    const state = stateWith([
      { id: "c-fit", mastery: 0.9, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
      { id: "c-untouched", mastery: 0.9, answers: [] },
    ]);
    const mem = conceptMemoryFromState(state);
    expect(mem["c-fit"]?.reps).toBe(1);
    expect(mem["c-fit"]?.last_reviewed_at).toBe(t0);
    expect(mem["c-untouched"]?.reps).toBe(0); // present but unseen
  });
});

describe("FSRS-as-router — reinforcementSceneFromState (route to content)", () => {
  const state = stateWith([
    { id: "c-fit", mastery: 0.9, answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
  ]);

  it("returns the scene whose concept_refs cover the due concept", () => {
    const bundle = bundleWithScenes([
      { id: "s-intro", concept_refs: ["c-other"] },
      { id: "s-fit-quiz", concept_refs: ["c-fit"] },
    ]);
    expect(reinforcementSceneFromState(bundle, state, t0 + 30 * DAY)).toBe("s-fit-quiz");
  });

  it("prefers an active RETRIEVAL scene over a passive intro that covers the same concept", () => {
    const bundle = bundleWithScenes([
      { id: "s-fit-intro", type: "intro", concept_refs: ["c-fit"] },
      { id: "s-fit-quiz", type: "quiz", concept_refs: ["c-fit"] },
    ]);
    expect(reinforcementSceneFromState(bundle, state, t0 + 30 * DAY)).toBe("s-fit-quiz");
  });

  it("falls back to the first covering scene when no retrieval scene covers the concept", () => {
    const bundle = bundleWithScenes([
      { id: "s-fit-intro", type: "intro", concept_refs: ["c-fit"] },
      { id: "s-fit-reading", type: "reading", concept_refs: ["c-fit"] },
    ]);
    expect(reinforcementSceneFromState(bundle, state, t0 + 30 * DAY)).toBe("s-fit-intro");
  });

  it("returns null when nothing is due", () => {
    const bundle = bundleWithScenes([{ id: "s-fit-quiz", concept_refs: ["c-fit"] }]);
    expect(reinforcementSceneFromState(bundle, state, t0)).toBeNull();
  });

  it("returns null when the due concept has no covering scene", () => {
    const bundle = bundleWithScenes([{ id: "s-other", concept_refs: ["c-other"] }]);
    expect(reinforcementSceneFromState(bundle, state, t0 + 30 * DAY)).toBeNull();
  });
});

describe("FSRS-as-router — host mirror is in LOCKSTEP with the authoritative engine", () => {
  // host.ts inlines the FSRS reinforcement mirror (it cannot import @studium/adaptation-engine). This
  // pins the host's nextReinforcementFromState decision to the engine's nextReinforcement over the SAME
  // replayed history + mastery, so the copied reinforcementPriority/dueForReinforcement cannot drift.
  it("host nextReinforcementFromState == engine nextReinforcement for the same answers + mastery", () => {
    const answers = [
      { id: "c-fit", mastery: 0.9, ans: { correct: true, hint_count: 0, atMs: t0 } },
      { id: "c-units", mastery: 0.7, ans: { correct: true, hint_count: 0, atMs: t0 } },
    ];
    const state = stateWith(answers.map((a) => ({ id: a.id, mastery: a.mastery, answers: [a.ans] })));
    const now = t0 + 45 * DAY;

    // Engine reference: replay the same answers through fsrs.ts + the same mastery values.
    const engineMem: Record<string, ReturnType<typeof engineDefaultMemory>> = {};
    const mastery: Record<string, number> = {};
    for (const a of answers) {
      engineMem[a.id] = engineReviewMemory(engineDefaultMemory(a.id), engineGrade(a.ans), a.ans.atMs);
      mastery[a.id] = a.mastery;
    }
    const enginePick = engineNextReinforcement(engineMem, mastery, now);
    const hostPick = nextReinforcementFromState(state, now)?.concept_id ?? null;
    expect(hostPick).toBe(enginePick);
    expect(hostPick).toBe("c-fit");
  });
});
