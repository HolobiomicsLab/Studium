// packages/lesson-session/src/gate-validity.ts
//
// Direction-2 synthetic-learner gate-validity harness: does the trust instrument mean what we claim, in
// BOTH directions, and does the certification gate hold/advance the right learners? We run synthetic
// learners with a KNOWN disposition through the REAL grader + folds + gate and measure recovery and the
// false-hold / false-advance rate — with ZERO students.
//
// NON-CIRCULARITY (the load-bearing rule): a learner's disposition is an INDEPENDENT generative parameter
// — P(flag | flawed) and P(flag | sound) — independent of the grader's scoring and the engine's thresholds.
// The simulator conditions ONLY on ground truth (to apply the right per-class flag probability), never on
// any label the grader produces; the REAL flawGrader then re-derives the deck and scores. Validation
// succeeds only if the instrument RECOVERS the hidden disposition — it is not fed back the grader's output.

import type { Scene } from "@studium/lesson-bundle-schema";
import {
  recordJudgmentAudit, recordJudgmentSdt, type ConceptState, type LearnerState,
} from "@studium/learner-state";
import { grade } from "./grading/index.js";
import { verdictDeck, mulberry32, seedFrom } from "./grading/deck.js";
import { buildMasteryClaims } from "./mastery-claims.js";
import type { CritiqueEvaluator } from "./ports.js";

/** A learner's hidden trust disposition. Set independently of the scorer; the instrument must recover it.
 * calibrated: high pFlagFlawed, low pFlagSound. over-truster: low both. over-distruster: high both. */
export interface Disposition { pFlagFlawed: number; pFlagSound: number }
export interface SyntheticLearner { label: string; disposition: Disposition }

export interface GateValidityRow {
  label: string;
  disposition: Disposition;
  trustGap: number;     // recovered signed gap (recordJudgmentAudit)
  aPrime: number;       // recovered discrimination (competence)
  criterionC: number;   // recovered bias (>0 over-trust, <0 over-distrust)
  certified: boolean;   // gate outcome, with competence held HIGH so it is purely a trust decision
}

const GROUNDED_RUN = {
  ran: true, passed: true, landmark: "L", figure_path: null,
  checks: [{ check: "produced", passed: true }],
  provenance: { capsule_doi: null, cmd: ["run"], env: "uv" },
};
const EVAL_STUB: CritiqueEvaluator = { async evaluate() { return { score: 1, feedback: "" }; } };
const MASTERY_OPTS = { pseudonym: "p", sessionId: "s", bundleId: "b", activeUniverseId: "", threshold: 0.8 };

/** A high-competence concept state, so the certification gate's only open question is TRUST. */
function masteredConcept(): ConceptState {
  return { ...({ concept_id: "c", alpha: 9, beta: 1, consecutive_errors: 0, total_attempts: 5, total_correct: 5, confidence_calibration: 0 }) };
}

function syntheticDeckScene(i: number, nFlawed: number, nSound: number): Extract<Scene, { type: "spot_the_flaw" }> {
  const claims = Array.from({ length: nFlawed }, (_, k) => ({ id: `f${i}_${k}`, text: `flawed ${i}.${k}`, flaws_expected: [`x${k}`] }));
  const sound_claims = Array.from({ length: nSound }, (_, k) => ({ id: `s${i}_${k}`, text: `sound ${i}.${k}` }));
  return {
    id: `gv${i}`, type: "spot_the_flaw", title: "t", objective_refs: [], concept_refs: ["c"],
    estimated_seconds: 1, adaptation_hooks: [], flawed_content: "reading", claims,
    model_correction: "m", rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
    sound_claims, verdict_deck: true, reference_result: GROUNDED_RUN,
  };
}

/** Simulate one learner's per-token verdicts over a deck from their disposition: flag a flawed item w.p.
 * pFlagFlawed and a sound item w.p. pFlagSound, each an independent draw. */
export function simulateVerdicts(
  scene: Extract<Scene, { type: "spot_the_flaw" }>, d: Disposition, rand: () => number,
): Array<{ token: string; flagged: boolean }> {
  return verdictDeck(scene.claims, scene.sound_claims ?? [], scene.id).map((item) => ({
    token: item.token,
    flagged: rand() < (item.flawed ? d.pFlagFlawed : d.pFlagSound),
  }));
}

function stateWith(cs: ConceptState): LearnerState {
  return {
    lesson_id: "l", schema_version: "1.0", concept_states: { [cs.concept_id]: cs },
    scenes_completed: [], scenes_replayed: {}, history: [], session_started_at: "2026-07-17T00:00:00Z", last_decision: null,
  };
}

/** Run each synthetic learner through the REAL deck grader + folds + certification gate and report what
 * the instrument recovered and whether the learner was certified. Competence is held high, so a withheld
 * claim is a pure trust decision. Deterministic given `seed`. */
export async function runGateValidity(
  learners: readonly SyntheticLearner[],
  opts: { scenes: number; flawedPerScene: number; soundPerScene: number; seed: number },
): Promise<GateValidityRow[]> {
  const scenes = Array.from({ length: opts.scenes }, (_, i) => syntheticDeckScene(i, opts.flawedPerScene, opts.soundPerScene));
  const rows: GateValidityRow[] = [];
  for (const learner of learners) {
    const rand = mulberry32((seedFrom(learner.label) ^ opts.seed) >>> 0);
    let cs = masteredConcept();
    for (const scene of scenes) {
      const verdicts = simulateVerdicts(scene, learner.disposition, rand);
      const r = await grade(scene, { kind: "flaw_verdicts", verdicts }, { critiqueEvaluator: EVAL_STUB });
      const ja = r.signal.kind === "answer_submitted" ? r.signal.judgment_audit : undefined;
      if (ja?.grounded) { cs = recordJudgmentAudit(cs, ja); cs = recordJudgmentSdt(cs, ja); }
    }
    const doc = buildMasteryClaims(stateWith(cs), MASTERY_OPTS);
    const certified = doc["@graph"].some((n) => n["@type"] === "asb:Claim");
    rows.push({
      label: learner.label, disposition: learner.disposition,
      trustGap: cs.trust_calibration ?? 0, aPrime: cs.trust_discrimination ?? NaN,
      criterionC: cs.trust_bias_c ?? NaN, certified,
    });
  }
  return rows;
}

/** The four canonical dispositions the validation exercises. */
export const CANONICAL_LEARNERS: readonly SyntheticLearner[] = [
  { label: "calibrated", disposition: { pFlagFlawed: 0.9, pFlagSound: 0.1 } },
  { label: "over-truster", disposition: { pFlagFlawed: 0.15, pFlagSound: 0.05 } },
  { label: "over-distruster", disposition: { pFlagFlawed: 0.9, pFlagSound: 0.85 } },
  { label: "concept-strong-but-credulous", disposition: { pFlagFlawed: 0.2, pFlagSound: 0.1 } },
];
