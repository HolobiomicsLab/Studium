// packages/lesson-session-host/src/host-fsrs.parity.test.ts
// Parity guard for the FSRS scheduler that host.ts INLINES verbatim (see the "FSRS read-side mirror"
// block in host.ts). The host cannot import @studium/adaptation-engine (undeclared dep, and a parallel
// workflow owns that package.json), so the scheduler is copied by hand — which silently drifts if
// fsrs.ts changes. This test pins the host copy against the AUTHORITATIVE scheduler in
// packages/adaptation-engine/src/fsrs.ts by replaying the SAME answer history through both and
// asserting numerically-identical retrievability / isDue / next-due, INCLUDING multi-review chains
// (reps >= 2: good → +30d → good → +60d → good, lapses, hinted answers).
//
// The host side is exercised through its PUBLIC surface — reviewQueueFromState() runs the inlined
// fsrsReviewMemory/fsrsRetrievability/fsrsIsDue/fsrsDueAt — so this tests the real shipped copy, not a
// re-export. The engine side imports fsrs.ts directly by relative path (a file import; no package dep
// needed for vitest's resolver).
import { describe, it, expect } from "vitest";
import {
  defaultLearnerState,
  defaultConceptState,
  type LearnerState,
  type Signal,
  type Decision,
} from "@studium/learner-state";
import { reviewQueueFromState } from "./host.js";
// Authoritative scheduler — relative file import (no @studium/adaptation-engine package dep).
import {
  defaultMemoryState,
  reviewMemory,
  gradeFromAnswer,
  retrievability as fsrsRetrievability,
  isDue as fsrsIsDue,
  dueAt as fsrsDueAt,
  type ConceptMemoryState,
} from "../../adaptation-engine/src/fsrs.js";

const DAY = 86_400_000;
const NOOP_DECISION: Decision = {
  next_action: { kind: "advance_to_next_scene" },
  rule_id: null,
  explanation_short: null,
  modulator: null,
};

type Ans = { correct: boolean; hint_count: number; atMs: number };

/** A LearnerState whose history is exactly `answers` (graded answer_submitted signals) for `concept_id`. */
function stateWithAnswers(concept_id: string, answers: Ans[]): LearnerState {
  const s = defaultLearnerState("lesson-parity");
  s.concept_states[concept_id] = defaultConceptState(concept_id);
  for (const a of answers) {
    const signal: Signal = {
      kind: "answer_submitted",
      concept_id,
      scene_id: "scn",
      correct: a.correct,
      time_ms: 1000,
      hint_count: a.hint_count,
      difficulty: 0.5,
    };
    s.history.push({
      timestamp: new Date(a.atMs).toISOString(),
      scene_id: "scn",
      signal,
      decision: NOOP_DECISION,
    });
  }
  return s;
}

/** Replay the SAME answers through the authoritative fsrs.ts to get the reference memory state. */
function referenceMemory(answers: Ans[]): ConceptMemoryState {
  let mem = defaultMemoryState("c1");
  for (const a of answers) {
    mem = reviewMemory(mem, gradeFromAnswer({ correct: a.correct, hint_count: a.hint_count }), a.atMs);
  }
  return mem;
}

const t0 = Date.parse("2026-06-20T10:00:00Z");

// A battery of histories. CRITICAL: several have reps >= 2 (multi-review) so the parity covers the
// stability/difficulty UPDATE path (not just the first-exposure seed) — the place drift hides.
const BATTERIES: Array<{ name: string; answers: Ans[] }> = [
  { name: "single good", answers: [{ correct: true, hint_count: 0, atMs: t0 }] },
  { name: "single hinted (grade=hard)", answers: [{ correct: true, hint_count: 2, atMs: t0 }] },
  { name: "single lapse (grade=again)", answers: [{ correct: false, hint_count: 0, atMs: t0 }] },
  {
    name: "good -> +30d good -> +60d good (multi-review)",
    answers: [
      { correct: true, hint_count: 0, atMs: t0 },
      { correct: true, hint_count: 0, atMs: t0 + 30 * DAY },
      { correct: true, hint_count: 0, atMs: t0 + 90 * DAY },
    ],
  },
  {
    name: "good -> +10d lapse -> +5d good (lapse then recover)",
    answers: [
      { correct: true, hint_count: 0, atMs: t0 },
      { correct: false, hint_count: 0, atMs: t0 + 10 * DAY },
      { correct: true, hint_count: 0, atMs: t0 + 15 * DAY },
    ],
  },
  {
    name: "hinted -> +20d good -> +40d hinted (mixed grades, reps=3)",
    answers: [
      { correct: true, hint_count: 1, atMs: t0 },
      { correct: true, hint_count: 0, atMs: t0 + 20 * DAY },
      { correct: true, hint_count: 3, atMs: t0 + 60 * DAY },
    ],
  },
  {
    name: "four reviews, same-day re-answers (reps=4)",
    answers: [
      { correct: true, hint_count: 0, atMs: t0 },
      { correct: true, hint_count: 0, atMs: t0 + 1 * DAY },
      { correct: false, hint_count: 0, atMs: t0 + 2 * DAY },
      { correct: true, hint_count: 0, atMs: t0 + 3 * DAY },
    ],
  },
];

// Probe times (relative to the LAST review) at which we read retrievability / due / due_at.
const PROBE_OFFSETS = [60_000, 7 * DAY, 30 * DAY, 90 * DAY, 365 * DAY];

const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("host.ts inlined FSRS is numerically identical to packages/adaptation-engine/src/fsrs.ts", () => {
  for (const battery of BATTERIES) {
    it(`matches on [${battery.name}] across all probes`, () => {
      const state = stateWithAnswers("c1", battery.answers);
      const refMem = referenceMemory(battery.answers);
      const lastReview = battery.answers[battery.answers.length - 1]!.atMs;

      for (const off of PROBE_OFFSETS) {
        const now = lastReview + off;

        // HOST side: the inlined scheduler, surfaced through reviewQueueFromState (replays the
        // SAME history through fsrsReviewMemory/Retrievability/IsDue/DueAt).
        const q = reviewQueueFromState(state, now);
        const hostItem = q.find((i) => i.concept_id === "c1");
        expect(hostItem, `host item missing at off=${off}`).toBeDefined();
        if (!hostItem) continue;

        // ENGINE side: authoritative fsrs.ts on the reference memory.
        const refR = fsrsRetrievability(refMem, now);
        const refDue = fsrsIsDue(refMem, now);
        const refDueAt = fsrsDueAt(refMem);

        expect(
          approx(hostItem.retrievability, refR),
          `retrievability mismatch [${battery.name}] off=${off}: host=${hostItem.retrievability} fsrs=${refR}`,
        ).toBe(true);
        expect(
          hostItem.due === refDue,
          `isDue mismatch [${battery.name}] off=${off}: host=${hostItem.due} fsrs=${refDue}`,
        ).toBe(true);
        expect(
          approx(hostItem.due_at, refDueAt),
          `due_at mismatch [${battery.name}] off=${off}: host=${hostItem.due_at} fsrs=${refDueAt}`,
        ).toBe(true);

        // reps + last_reviewed_at must also agree (the host replays the same number of reviews).
        expect(hostItem.reps).toBe(refMem.reps);
        expect(hostItem.last_reviewed_at).toBe(refMem.last_reviewed_at);
      }
    });
  }
});
