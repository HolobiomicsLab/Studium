import type { LearningWorkflowGraph } from "@studium/learning-workflow-schema";
import { isAvailable, remediationTarget, retrievability, DEFAULT_THETA, type Mastery } from "@studium/adaptation-engine";
import {
  masteryOf, effectiveMastery, isMiscalibrated, isTrustMiscalibrated, type ConceptState, type ConceptMemoryState,
} from "@studium/learner-state";

/** Minimum total_attempts a concept must accumulate before its mastery can count as MASTERED.
 * Without this floor, mastery is trivially cheap: 2 correct quiz answers push alpha/(alpha+beta)
 * to 0.8 (= default theta), so prereq-gating, nextConcept and demonstrates_mastery_of Claims all
 * fire on just 2 answers. Below the floor a concept is treated as not-mastered (locked / no claim). */
export const MIN_MASTERY_ATTEMPTS = 3;

/** Build a GraphRouter mastery map from learner concept_states.
 * concept_states keys are grading concept_ids == objective ids (post concept-id alignment);
 * LWG concept node ids are `concept:<objective id>` — so we re-prefix.
 * A concept is included ONLY once it has been attempted at least `minAttempts` times; below the
 * floor it is OMITTED so GraphRouter treats it as not-mastered/locked (minimum-attempts floor). */
export function buildLwgMastery(
  conceptStates: Record<string, ConceptState>,
  minAttempts: number = MIN_MASTERY_ATTEMPTS,
): Mastery {
  const m: Mastery = {};
  for (const [cid, cs] of Object.entries(conceptStates)) {
    if (cs.total_attempts < minAttempts) continue; // below the floor -> not yet masterable -> omit
    m[`concept:${cid}`] = masteryOf(cs);
  }
  return m;
}

/** The SKIP view of mastery (RT-2): EFFECTIVE mastery per concept — the posterior times the FSRS
 * retrievability at `nowMs` (learner-state `effectiveMastery`) — with the same minimum-attempts floor
 * as buildLwgMastery. A concept with no reviewed memory keeps its posterior (no retention evidence is
 * not a decay), and so does every concept when the time is unknown. Only skip-on-mastery reads it:
 * the prerequisite gates and the mastery claims stay on the posterior, whose termination and
 * certification contracts were built on it. */
export function buildLwgEffectiveMastery(
  conceptStates: Record<string, ConceptState>,
  memory: Record<string, ConceptMemoryState> | undefined,
  nowMs: number,
  minAttempts: number = MIN_MASTERY_ATTEMPTS,
): Mastery {
  const m: Mastery = {};
  for (const [cid, cs] of Object.entries(conceptStates)) {
    if (cs.total_attempts < minAttempts) continue;
    const mem = memory?.[cid];
    const reviewed = mem !== undefined && mem.reps > 0 && mem.last_reviewed_at !== null && Number.isFinite(nowMs);
    m[`concept:${cid}`] = effectiveMastery(masteryOf(cs), reviewed ? retrievability(mem, nowMs) : undefined);
  }
  return m;
}

/** Build a calibration GATE map for the skip path: a concept node id maps to `false` iff its mastery
 * is MEASURED-miscalibrated on EITHER calibration axis — confidence (declared-vs-competence) OR trust
 * (judgment-over-artifact: did the learner correctly distrust a flawed AI reading of a real result) —
 * so skip-on-mastery will NOT skip past it (the learner does the scene to recalibrate). Calibrated or
 * unmeasured concepts are omitted (no gate). Keyed `concept:<id>` to match the LWG node ids and the
 * mastery map. SYMMETRIC (either direction) by design — a recalibration replay is a low-cost nudge for
 * an over- OR under-calibrated learner. (Distinct from the CERTIFICATION gate in mastery-claims, which
 * is over-confidence/over-trust-only so it never withholds a proven master's claim.)
 * (Trust's over-DIStrust direction is symmetric here by construction but unfed in production today —
 * the flaw matcher reports no false positives yet; see learner-state trust_calibration honesty boundary.) */
export function buildLwgCalibration(conceptStates: Record<string, ConceptState>): Record<string, boolean> {
  const g: Record<string, boolean> = {};
  for (const [cid, cs] of Object.entries(conceptStates)) {
    if (isMiscalibrated(cs) || isTrustMiscalibrated(cs)) g[`concept:${cid}`] = false;
  }
  return g;
}

/** The LWG concept node id a scene teaches/assesses (its first concept_ref), or null. */
// multi-ref scenes gate on the first concept_ref only (simplification; deferred).
export function sceneConceptId(scene: { concept_refs?: string[] }): string | null {
  const ref = scene.concept_refs?.[0];
  return ref ? `concept:${ref}` : null;
}

/** Index of the first scene whose LWG concept == conceptId, or -1. */
export function firstSceneForConcept(scenes: { concept_refs?: string[] }[], conceptId: string): number {
  return scenes.findIndex((s) => sceneConceptId(s) === conceptId);
}

/** Scene types this router will send a learner back to for remediation.
 *
 * The comment here used to read "scene types whose grading emits an answer_submitted signal". That
 * was never true and is measurably not true now: EIGHT types emit one (quiz plus the seven
 * free-text types), and this set names two of them. `answer-graded-types.contract.test.ts` runs the
 * real graders and pins the three-way gap, so the numbers below cannot go stale silently.
 *
 * Since INT-STUDIUM-035 candidate 2 (the owner's decision of 2026-09-10) emitting an
 * `answer_submitted` no longer implies moving mastery either: offline only `quiz` and
 * `spot_the_flaw`'s VERDICT DECK carry a `correct`, because those two are scored against the key by
 * identity. The other six carry one only when a live evaluator declares `source: "llm"`. So the
 * predicate a router actually wants — "can a detour here raise mastery?" — is no longer a property
 * of the scene type alone, and this set matches neither the emitting types nor the certifying ones.
 *
 * INT-STUDIUM-037 deliberately leaves the MEMBERSHIP alone. Widening it would route offline
 * learners into scenes that provably cannot converge, and shrinking it would cost a live deployment
 * its free-text remediation; choosing between them is the routing decision that intent files and
 * does not take. What it does fix is the SILENCE when this set finds nothing — see
 * `gate_unassessable` below. */
export const ANSWER_GRADED_TYPES: ReadonlySet<string> = new Set(["quiz", "ai_critique"]);

/** Mastery pacing may remove authored exposition/checks, but never judgment or practice scenes. */
export const MASTERY_SKIPPABLE_TYPES: ReadonlySet<string> = new Set(["intro", "concept", "quiz"]);

/** Index of the first scene of a remediable type for the concept, or -1 when there is none —
 * the case `gate_unassessable` reports. */
export function firstAnswerGradedSceneForConcept(
  scenes: { concept_refs?: string[]; type?: string }[],
  conceptId: string,
): number {
  return scenes.findIndex((s) => sceneConceptId(s) === conceptId && ANSWER_GRADED_TYPES.has(s.type ?? ""));
}

/** Index of the first ANSWER-GRADED scene for `conceptId` whose id is NOT in `seen`, or -1. */
export function firstUnseenAnswerGradedSceneForConcept(
  scenes: { id?: string; concept_refs?: string[]; type?: string }[],
  conceptId: string,
  seen: Set<string>,
): number {
  return scenes.findIndex(
    (s) => sceneConceptId(s) === conceptId && ANSWER_GRADED_TYPES.has(s.type ?? "") && !seen.has(s.id ?? ""),
  );
}

/** How many times the gate may route a learner back to the SAME unmet prerequisite before it
 * gives up and lets them through. Remediation assumes mastery rises on replay; for a learner
 * whose answers keep grading wrong it never does, and without a bound the lesson never ends
 * (observed on atomistique-l1: 199 replays of one scene in 400 steps, no completion). Three is
 * a real second and third chance, not an unbounded one. */
export const MAX_PREREQ_DETOURS = 3;

export type GraphNavReason = "advance" | "remediate" | "skip_mastered" | "gate_released" | "gate_unassessable";
export interface GraphNavResult {
  index: number | null; // null => no scene to advance to (caller completes)
  reason: GraphNavReason;
  /** The LOCKED candidate the gate is holding the learner back from (remediate / gate_released /
   * gate_unassessable). Lets the caller say where the detour returns to, and release the gate
   * without re-running the router. */
  gated?: number;
  /** The unmet prerequisite responsible for a remediation or open gate. */
  prerequisite?: string;
}

/** Choose the next scene (graph-aware). Used only when the bundle carries an LWG.
 * - skipMastered (pacing=skip_on_mastery): skip forward over scenes whose concept is already
 *   mastered (>= theta), stopping at the first concept-less or unmastered scene.
 * - landed candidate available (or concept-less) => advance there.
 * - landed candidate LOCKED => remediate to an answer-graded scene for the weakest unmet prereq,
 *   but at most MAX_PREREQ_DETOURS times for that prereq: remediation only converges if the
 *   learner's mastery actually rises, and for one whose answers keep grading wrong it does not.
 *   Past the budget the gate RELEASES (reason "gate_released") and the lesson advances unmastered;
 *   if no remedial scene exists at all the gate opens immediately, reported as "gate_unassessable"
 *   — a different fact, and one about the bundle rather than the learner. Either way the lesson
 *   ends, and either way the caller says so out loud. */
export function graphAwareNextIndex(
  scenes: { id?: string; concept_refs?: string[]; type?: string }[],
  currentIdx: number,
  lwg: LearningWorkflowGraph,
  mastery: Mastery,
  theta: number = DEFAULT_THETA,
  skipMastered = false,
  calibrated: Record<string, boolean> = {},
  /** Detours ALREADY spent per prerequisite concept id, this session. Omitted ⇒ unbounded
   * (the previous behaviour), so existing callers are unaffected. */
  prereqDetours: Record<string, number> = {},
  /** Scene ids already served in this session; unseen remediation items take priority. */
  seen: ReadonlySet<string> = new Set(),
  /** Correctly answered prerequisites count as passed even while posterior mastery is below theta. */
  passedPrerequisites: ReadonlySet<string> = new Set(),
  /** What skip-on-mastery reads (buildLwgEffectiveMastery). Omitted ⇒ `mastery`, the previous
   * behaviour. The gates always read `mastery`. */
  skipMastery: Mastery = mastery,
  /** Ids of answer-graded scenes the learner answered correctly in this session. One that lies
   * ahead was served out of order (a prerequisite detour or an alternate item) and is passed
   * over: asking again a question just answered right teaches nothing, and its reference has
   * been shown. Not reported as a skip: the scene was done. */
  answeredRight: ReadonlySet<string> = new Set(),
  /** Audit 2026-11-10 A2 (C2): ids of scenes whose reference a verdict released to the learner
   * (LearnerState `reference_shown`). None is served again as a graded question: one that lies ahead
   * is passed over like a scene answered right, and a gate never remediates on one — with no other
   * item of the prerequisite left, the gate is reported unassessable rather than passed from memory. */
  referenceShown: ReadonlySet<string> = new Set(),
): GraphNavResult {
  const routingMastery: Mastery = { ...mastery };
  for (const conceptId of passedPrerequisites) routingMastery[conceptId] = 1;
  const alreadyRight = (i: number): boolean => referenceShown.has(scenes[i]!.id ?? "")
    || (ANSWER_GRADED_TYPES.has(scenes[i]!.type ?? "") && answeredRight.has(scenes[i]!.id ?? ""));
  let candidate = currentIdx + 1;
  let skipped = false;
  while (candidate < scenes.length) {
    if (alreadyRight(candidate)) { candidate += 1; continue; }
    if (!skipMastered) break;
    const scene = scenes[candidate]!;
    const c = sceneConceptId(scene);
    // stop at: concept-less, unmastered, OR mastered-but-MISCALIBRATED (calibration gate — don't
    // skip a concept the learner's self-assessment is out of band on; let them do the scene).
    // Judgment/practice/reproduction scenes are never skippable: quiz mastery is not evidence that
    // the learner can evaluate an AI output, explain, compare, communicate, or perform the task.
    // A session-local prerequisite pass releases dependency gates only; it is not posterior
    // mastery and therefore must not make ordinary authored scenes skippable.
    if (!MASTERY_SKIPPABLE_TYPES.has(scene.type ?? "")
      || c === null || (skipMastery[c] ?? 0) < theta || calibrated[c] === false) break;
    candidate += 1;
    skipped = true;
  }
  if (candidate >= scenes.length) return { index: null, reason: "advance" };
  const cid = sceneConceptId(scenes[candidate]!);
  if (cid === null || isAvailable(lwg, cid, routingMastery, theta)) {
    return { index: candidate, reason: skipped ? "skip_mastered" : "advance" };
  }
  const remedial = remediationTarget(lwg, cid, routingMastery, theta);
  if (remedial) {
    // BUDGET FIRST: past it, stop routing back and let the learner into the gated scene. The
    // release is a fact the caller reports (graph_prereq_gate_released) — an unmastered pass is
    // a worse outcome than a mastered one, but a strictly better one than a lesson that ends
    // nowhere. `>=` because the count is detours already SPENT.
    if ((prereqDetours[remedial] ?? 0) >= MAX_PREREQ_DETOURS) {
      return { index: candidate, reason: "gate_released", gated: candidate };
    }
    const unseen = firstUnseenAnswerGradedSceneForConcept(scenes, remedial, new Set([...seen, ...referenceShown]));
    const ri = unseen >= 0 ? unseen : firstUnseenAnswerGradedSceneForConcept(scenes, remedial, new Set(referenceShown));
    if (ri >= 0) return { index: ri, reason: "remediate", gated: candidate };
    // An item of the prerequisite exists but its key was shown (C2): the same fact for the learner as
    // none at all — no step of this lesson can revisit the concept now — so the same report below.
    // NO REMEDIAL SCENE AT ALL. The prerequisite is unmet and the lesson holds nothing this router
    // can send the learner back to, so the gate opens on the first try — without spending a detour
    // and, until INT-STUDIUM-037, without saying anything: this returned a plain "advance", which
    // is what the caller emits for an ordinary next-scene step. Measured on atomistique-l1, a
    // learner who has mastered nothing walks into a gated scene FOUR times this way and
    // `graph_prereq_gate_released` fires zero times.
    //
    // It is a distinct fact from the budget release and must not borrow its rule_id: "we tried
    // three times and it did not take" is a statement about the learner; "there was nothing to
    // try" is a statement about the BUNDLE — the prerequisite has no scene this router can use to
    // assess it. The caller announces it separately (graph_prereq_unassessable).
    return { index: candidate, reason: "gate_unassessable", gated: candidate, prerequisite: remedial };
  }
  return { index: candidate, reason: skipped ? "skip_mastered" : "advance" };
}
