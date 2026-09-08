/**
 * Spaced-repetition retention scheduling (FSRS-derived) — the "when to re-surface a
 * concept" complement to Beta mastery (roadmap slice #1, concept reinforcement).
 *
 * Mastery (alpha/beta → masteryOf) answers *did the learner demonstrate the concept*;
 * retention (this module) answers *will they still recall it now*. A concept that is
 * mastered but whose retrievability is decaying is the prime candidate for a reinforcement
 * task — the signal `dueForReinforcement` surfaces.
 *
 * Implements the FSRS-4.5 power-forgetting curve and stability/difficulty update with the
 * published default weights (tunable per-cohort later). Pure + dependency-free; time is
 * always passed in as an explicit `nowMs` (epoch ms) so the scheduler is deterministic and
 * testable. NOT yet wired into LearnerState serialization — when it is, add a Zod
 * `ConceptMemoryStateSchema` in @studium/learner-state and persist `concept_memory` beside
 * `concept_states`, updating it on each `answer_submitted` via `reviewMemory(...)`.
 */

export type ReviewGrade = 1 | 2 | 3 | 4; // again | hard | good | easy

export interface ConceptMemoryState {
  concept_id: string;
  /** Memory stability in DAYS (the interval at which retrievability = requestRetention). 0 = unseen. */
  stability: number;
  /** Item difficulty in [1,10]; 0 = unseen (set on first review). */
  difficulty: number;
  /** Epoch ms of the last review; null = unseen. */
  last_reviewed_at: number | null;
  reps: number;
  lapses: number;
}

const DAY_MS = 86_400_000;
const DECAY = -0.5;
const FACTOR = 19 / 81; // FSRS-4.5/5 forgetting-curve constant

/**
 * FSRS weight vector: a fixed-length tuple (w0..w16) so indexed reads are `number`
 * rather than `number | undefined` under `noUncheckedIndexedAccess`.
 */
export type FsrsWeights = readonly [
  number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
];

/** FSRS-4.5 published default weights (w0..w16). Replace with per-cohort fits later. */
export const FSRS_DEFAULT_W: FsrsWeights = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61,
];

const clampD = (d: number): number => Math.max(1, Math.min(10, d));

export function defaultMemoryState(concept_id: string): ConceptMemoryState {
  return { concept_id, stability: 0, difficulty: 0, last_reviewed_at: null, reps: 0, lapses: 0 };
}

/** Retrievability R(t) ∈ (0,1] given elapsed time since the last review. Unseen → 0 (max due). */
export function retrievability(s: ConceptMemoryState, nowMs: number): number {
  if (s.reps === 0 || s.last_reviewed_at === null || s.stability <= 0) return 0;
  const tDays = Math.max(0, (nowMs - s.last_reviewed_at) / DAY_MS);
  return Math.pow(1 + FACTOR * (tDays / s.stability), DECAY);
}

/** Days until retrievability decays to `requestRetention` (default 0.9). Unseen → 0. */
export function intervalDays(s: ConceptMemoryState, requestRetention = 0.9): number {
  if (s.stability <= 0) return 0;
  return (s.stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
}

/** Epoch ms when this concept becomes due for reinforcement. Unseen → 0 (i.e. due now). */
export function dueAt(s: ConceptMemoryState, requestRetention = 0.9): number {
  if (s.last_reviewed_at === null) return 0;
  return s.last_reviewed_at + intervalDays(s, requestRetention) * DAY_MS;
}

export function isDue(s: ConceptMemoryState, nowMs: number, requestRetention = 0.9): boolean {
  if (s.reps === 0 || s.last_reviewed_at === null) return true;
  return dueAt(s, requestRetention) <= nowMs;
}

/** Map a graded answer to an FSRS rating. Wrong → again; right WITH hints → hard (anti-offloading,
 *  M5: leaning on hints earns a weaker schedule bump); right with no hints → good. */
export function gradeFromAnswer(a: { correct: boolean; hint_count: number }): ReviewGrade {
  if (!a.correct) return 1;
  return a.hint_count > 0 ? 2 : 3;
}

function initialStability(g: ReviewGrade, w: FsrsWeights): number {
  // w0..w3 are the per-grade seed stabilities (again|hard|good|easy) = w[g - 1]
  const s0 = g === 1 ? w[0] : g === 2 ? w[1] : g === 3 ? w[2] : w[3];
  return Math.max(0.1, s0);
}
function initialDifficulty(g: ReviewGrade, w: FsrsWeights): number {
  return clampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);
}

/** Apply one review to a concept's memory state, returning the new state (immutable). */
export function reviewMemory(
  s: ConceptMemoryState,
  grade: ReviewGrade,
  nowMs: number,
  w: FsrsWeights = FSRS_DEFAULT_W,
): ConceptMemoryState {
  // first exposure: seed stability/difficulty from the grade
  if (s.reps === 0 || s.last_reviewed_at === null || s.stability <= 0) {
    return {
      ...s,
      stability: initialStability(grade, w),
      difficulty: initialDifficulty(grade, w),
      last_reviewed_at: nowMs,
      reps: 1,
      lapses: grade === 1 ? 1 : 0,
    };
  }
  const R = retrievability(s, nowMs);
  // difficulty: mean-revert toward D0(good), nudged by how the answer went
  const dNext = clampD(w[7] * initialDifficulty(3, w) + (1 - w[7]) * (s.difficulty - w[6] * (grade - 3)));
  let sNext: number;
  if (grade === 1) {
    // lapse: post-lapse stability, never above the pre-lapse value
    const sLapse =
      w[11] * Math.pow(dNext, -w[12]) * (Math.pow(s.stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
    sNext = Math.max(0.1, Math.min(sLapse, s.stability));
  } else {
    // successful recall: stability grows more when reviewed later (low R = spacing effect)
    const hardPenalty = grade === 2 ? w[15] : 1;
    const easyBonus = grade === 4 ? w[16] : 1;
    const inc =
      Math.exp(w[8]) *
      (11 - dNext) *
      Math.pow(s.stability, -w[9]) *
      (Math.exp(w[10] * (1 - R)) - 1) *
      hardPenalty *
      easyBonus;
    sNext = s.stability * (1 + Math.max(0, inc));
  }
  return {
    ...s,
    stability: sNext,
    difficulty: dNext,
    last_reviewed_at: nowMs,
    reps: s.reps + 1,
    lapses: s.lapses + (grade === 1 ? 1 : 0),
  };
}

/** Reinforcement priority: high when a concept is well-mastered yet its recall is decaying.
 *  `masteryP` ∈ [0,1] from masteryOf(); `r` = retrievability ∈ [0,1]. */
export function reinforcementPriority(masteryP: number, r: number): number {
  return masteryP * (1 - r);
}

/** Concepts due for a reinforcement task now, most-urgent first. Only mastered concepts
 *  (≥ minMastery) that are due are returned — new/unlearned concepts are handled by the
 *  normal prerequisite-gated path, not by reinforcement. */
export function dueForReinforcement(
  states: Record<string, ConceptMemoryState>,
  mastery: Record<string, number>,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): string[] {
  const { requestRetention = 0.9, minMastery = 0.6 } = opts;
  return Object.values(states)
    .filter(
      (s) =>
        s.reps > 0 &&
        (mastery[s.concept_id] ?? 0) >= minMastery &&
        isDue(s, nowMs, requestRetention),
    )
    .map((s) => ({ id: s.concept_id, p: reinforcementPriority(mastery[s.concept_id] ?? 0, retrievability(s, nowMs)) }))
    .sort((a, b) => b.p - a.p)
    .map((x) => x.id);
}

/** ROUTER head: the single most-urgent concept to reinforce NOW, or `null` if none is due. This is the
 *  decision that promotes FSRS from a *readout* (dueForReinforcement's full list / the host reviewQueue)
 *  to a *router* — "what should the learner reinforce next" — that a selection loop can act on. */
export function nextReinforcement(
  states: Record<string, ConceptMemoryState>,
  mastery: Record<string, number>,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): string | null {
  return dueForReinforcement(states, mastery, nowMs, opts)[0] ?? null;
}
