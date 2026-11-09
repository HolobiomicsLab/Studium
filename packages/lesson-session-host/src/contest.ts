// Contesting a concept (INT-STUDIUM-058 § 2.7, F10). The learner may say « I know it » of a concept
// the map does not show as acquired, or « I am not sure » of an acquired one. A declaration is not
// evidence: it moves no mastery and skips no scene. The host answers with check questions taken from
// the lesson, two when it has them, each graded as any answer; the contest and what the answers
// showed are recorded. The scene choice follows the review sessions (review-session.ts): a scene whose
// FIRST concept is the contested one, never a diagnostic, never one that needs a learner-time run —
// and here only a scene graded against the author's key, so that the outcome needs no judge.
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import type { ContestRecord } from "@studium/lesson-session";
import type { ConceptMapState } from "./concept-map.js";
import { answerGraded, isDiagnosticScene, playableOutsideItsLesson } from "./review-session.js";

export type ContestClaim = ContestRecord["claim"];
export type ContestOutcome = ContestRecord["outcome"];
/** The check questions of a contest (owner's decision, 6 Nov 2026): two, from two different scenes. */
export const CONTEST_QUESTIONS = 2;

/** The declaration a state leaves open: « I am not sure » of an acquired concept, « I know it » of any other. */
export const claimFor = (state: ConceptMapState): ContestClaim => (state === "acquired" ? "unsure" : "known");

/** The scenes a contest of `conceptId` asks, in the order asked: key-graded scenes of that concept in
 * lesson order, those not yet answered in this session first, the scene on screen left out (the learner
 * is about to answer it anyway). Empty when the lesson has none: the concept cannot be contested. */
export function checkScenes(
  bundle: Pick<LessonBundle, "scenes">, conceptId: string, session: { currentSceneId: string | null; answered: ReadonlySet<string> },
): string[] {
  const candidates = bundle.scenes.filter((scene) => answerGraded(scene) && scene.concept_refs[0] === conceptId
    && playableOutsideItsLesson(scene) && !isDiagnosticScene(bundle as LessonBundle, scene) && scene.id !== session.currentSceneId);
  const fresh = candidates.filter((scene) => !session.answered.has(scene.id));
  const seen = candidates.filter((scene) => session.answered.has(scene.id));
  return [...fresh, ...seen].slice(0, CONTEST_QUESTIONS).map((scene) => scene.id);
}

/** What the answers showed. With fewer questions than a contest asks, the outcome is partial whatever
 * the answer. Otherwise the claim is confirmed when every answer goes its way (right for « I know
 * it », wrong for « I am not sure »), refuted as soon as one does not. */
export function contestOutcome(claim: ContestClaim, results: readonly boolean[]): ContestOutcome {
  if (results.length < CONTEST_QUESTIONS) return "partial";
  return results.every((right) => right === (claim === "known")) ? "confirmed" : "refuted";
}

/** A contest under way: the scenes asked and the results so far (true: answered right). */
export interface ContestPending { concept_id: string; claim: ContestClaim; scene_ids: string[]; results: boolean[] }

/** The contests of a session, as the concept-map record tells them. */
export interface RecordContest {
  /** The contest whose check questions are being asked, or null. */
  pending: { concept_id: string; claim: ContestClaim; asked: number; answered: number } | null;
  /** Per concept, how many check questions a contest would ask now; 0: it cannot be contested now (no
   * key-graded question, a contest already under way, or the lesson complete). */
  questions: Record<string, number>;
  /** The contests settled in this session, oldest first. */
  history: ContestRecord[];
}

/** A contest the host does not open; `message` says why in one line. */
export class ContestRefusedError extends Error {
  constructor(message: string) { super(message); this.name = "ContestRefusedError"; }
}
