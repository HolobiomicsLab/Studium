// packages/lesson-session/src/self-rating.ts
//
// Contract C4 (sprint 2026-10-30, spec D5): after a production answer that no judge certified, the
// learner compares their answer with the reference and rates their own recall. The rating is FSRS
// input only — it schedules the next review and never moves mastery, which only graded evidence
// moves. The session validates and records it (LessonSession.rateRecall); the host folds the FSRS
// grade into the learner's memory. The grade scale is the scheduler's own (adaptation-engine fsrs.ts).
import { gradeFromSelfRating, SELF_RATING_GRADES, type ReviewGrade, type SelfRating } from "@studium/adaptation-engine";

/** The grades a learner chooses from, in FSRS order (again = 1 … easy = 4). */
export const SELF_RATING_CHOICES: readonly SelfRating[] = (Object.keys(SELF_RATING_GRADES) as SelfRating[])
  .sort((a, b) => SELF_RATING_GRADES[a] - SELF_RATING_GRADES[b]);

/** Carried by the transition after an uncertified production answer. */
export interface SelfRatingRequest {
  requested: true;
  grades: SelfRating[];
}

/** What LessonSession.rateRecall recorded: the FSRS grade, its provenance, and when. */
export interface SelfRatingRecord {
  scene_id: string;
  concept_id: string;
  grade: SelfRating;
  fsrs_grade: ReviewGrade;
  source: "self_rated";
  rated_at: string;
}

export function isSelfRating(value: unknown): value is SelfRating {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SELF_RATING_GRADES, value);
}

export function fsrsGradeOf(grade: SelfRating): ReviewGrade {
  return gradeFromSelfRating(grade);
}

/** A fresh request per transition, so no consumer can mutate a shared array. */
export function selfRatingRequest(): SelfRatingRequest {
  return { requested: true, grades: [...SELF_RATING_CHOICES] };
}
