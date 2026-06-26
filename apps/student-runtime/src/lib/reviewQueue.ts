// Surfacing the spaced-repetition (FSRS) review schedule + the metacognitive calibration verdict
// to the LEARNER. The FSRS scheduler (packages/adaptation-engine/src/fsrs.ts) already *computes*
// these signals every turn — this module makes them visible without leaking the live numeric
// mastery (which stays hidden from the learner by default).
//
// We reconstruct each concept's FSRS memory state by replaying its `answer_submitted` history
// through the REAL scheduler (`reviewMemory` + `gradeFromAnswer`), then read `isDue` / `dueAt` /
// `retrievability`. The browser runtime already depends on @studium/adaptation-engine, so this is
// the authoritative scheduler — not a copy.
import {
  defaultMemoryState,
  reviewMemory,
  gradeFromAnswer,
  isDue,
  dueAt,
  retrievability,
  type ConceptMemoryState,
} from "@studium/adaptation-engine";
import type { ConceptState, LearnerState } from "@studium/learner-state";

export interface ReviewItem {
  concept_id: string;
  due: boolean;
  due_at: number;
  retrievability: number;
  reps: number;
}

function memoryFromHistory(concept_id: string, state: LearnerState): ConceptMemoryState {
  let mem = defaultMemoryState(concept_id);
  for (const h of state.history) {
    const sig = h.signal;
    if (sig.kind !== "answer_submitted" || sig.concept_id !== concept_id) continue;
    const t = Date.parse(h.timestamp);
    if (Number.isNaN(t)) continue;
    mem = reviewMemory(mem, gradeFromAnswer({ correct: sig.correct, hint_count: sig.hint_count }), t);
  }
  return mem;
}

/** The learner's spaced-repetition review queue, most-urgent (lowest retrievability) first. Concepts
 * with no graded answers are omitted (they follow the normal prerequisite path, not review). */
export function reviewQueue(
  state: LearnerState,
  nowMs: number = Date.now(),
  requestRetention = 0.9,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const concept_id of Object.keys(state.concept_states)) {
    const mem = memoryFromHistory(concept_id, state);
    if (mem.reps === 0) continue;
    items.push({
      concept_id,
      due: isDue(mem, nowMs, requestRetention),
      due_at: dueAt(mem, requestRetention),
      retrievability: retrievability(mem, nowMs),
      reps: mem.reps,
    });
  }
  return items.sort((a, b) => a.retrievability - b.retrievability);
}

/** Concepts due for review right now. */
export function dueConcepts(state: LearnerState, nowMs: number = Date.now()): ReviewItem[] {
  return reviewQueue(state, nowMs).filter((i) => i.due);
}

export type CalibrationBand = "bien" | "sur" | "sous";
export interface CalibrationVerdict {
  concept_id: string;
  band: CalibrationBand;
  message: string;
}

/** Below this absolute gap the learner is "bien calibré·e". Matches the engine's calibration rule
 * (|gap| ≥ 0.4 trips an adaptation), see learner-state.updateCalibration. */
export const CALIBRATION_WELL_BAND = 0.4;

/** Map a concept's hidden signed `confidence_calibration` to a learner-facing, NUMBER-FREE verdict.
 * Sign matches learner-state: positive ⇒ surconfiant (overconfident), negative ⇒ sous-confiant. The
 * raw gap and the numeric mastery are NEVER exposed. Returns null before any attempt. */
export function calibrationVerdict(cs: ConceptState): CalibrationVerdict | null {
  if (cs.total_attempts === 0) return null;
  const gap = cs.confidence_calibration;
  if (Math.abs(gap) < CALIBRATION_WELL_BAND) {
    return {
      concept_id: cs.concept_id,
      band: "bien",
      message: "Ta confiance était bien calibrée : ton ressenti collait à ta maîtrise réelle.",
    };
  }
  if (gap > 0) {
    return {
      concept_id: cs.concept_id,
      band: "sur",
      message:
        "Tu étais un peu surconfiant·e : tu te sentais plus sûr·e que ne le montrent tes réponses. " +
        "Vérifie ce concept avant de passer à la suite.",
    };
  }
  return {
    concept_id: cs.concept_id,
    band: "sous",
    message:
      "Tu étais un peu sous-confiant·e : tu maîtrises ce concept mieux que tu ne le penses. Fais-toi confiance.",
  };
}
