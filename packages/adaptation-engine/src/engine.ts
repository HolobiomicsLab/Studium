import type { LearnerState, ConceptState, Signal, Decision } from "@studium/learner-state";
import { defaultConceptState, recordConfidenceSample, CALIBRATION_ANSWER_LAMBDA, recordJudgmentAudit, recordJudgmentSdt } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";
import { updateBeta, recordUngradedAttempt } from "./beta-updater";
import { matchesCondition } from "./condition-matcher";

function masteryOf(s: ConceptState): number {
  return s.alpha / (s.alpha + s.beta);
}

function ensureConceptState(state: LearnerState, concept_id: string): ConceptState {
  if (!state.concept_states[concept_id]) {
    state.concept_states[concept_id] = defaultConceptState(concept_id);
  }
  return state.concept_states[concept_id];
}

function buildContext(state: LearnerState, signal: Signal): Record<string, number | string | boolean> {
  const ctx: Record<string, number | string | boolean> = {};
  if (signal.kind === "answer_submitted") {
    const cs = state.concept_states[signal.concept_id] ?? defaultConceptState(signal.concept_id);
    // An answer whose correctness was never measured publishes NO `answer_correct` (INT-STUDIUM-035
    // candidate 2). `matchesCondition` refuses a rule whose key is absent from the context, so no
    // rule fires on it — which is the whole point: `answer_correct: false` here would send the
    // learner into remediation for an answer nobody graded, moving the false claim rather than
    // removing it. The count is published either way, so a bundle CAN route on "ungradeable here".
    if (signal.correct !== undefined) ctx.answer_correct = signal.correct;
    ctx.ungraded_attempts = cs.ungraded_attempts ?? 0;
    ctx.hint_count = signal.hint_count;
    ctx.time_on_scene = signal.time_ms / 1000;
    ctx.consecutive_errors_same_concept = cs.consecutive_errors;
    ctx.mastery_c = masteryOf(cs);
    ctx.total_attempts = cs.total_attempts;
    ctx.total_correct = cs.total_correct;
    // A calibration that was never measured is NOT a calibration of zero, and both axes used to
    // publish one anyway: confidence_calibration defaults to 0, trust_calibration was read as `?? 0`.
    // A learner who had declared no confidence and audited no AI output therefore reached a bundle
    // rule as PERFECTLY CALIBRATED on both — and an audit catching every planted flaw measures that
    // very same 0, so the number could not tell the two apart. learner-state already draws the line
    // (isCalibrated / isTrustCalibrated require >=1 sample before reading the gap), and
    // matchesCondition makes absence a first-class answer (`if (!(key in ctx)) return false`), so an
    // unmeasured axis now fires no rule instead of firing the wrong one. The sample COUNTS are
    // published either way, so a bundle that wants to route ON "never asked" can say so. (INT-STUDIUM-029)
    const confidenceSamples = cs.calibration_samples ?? 0;
    ctx.calibration_samples = confidenceSamples;
    if (confidenceSamples >= 1) {
      ctx.confidence_calibration_abs = Math.abs(cs.confidence_calibration);
    }
    // the FRESHLY-updated trust calibration (judgment-over-artifact), signed + abs, so a bundle rule
    // can route on it (e.g. show_explanation_panel when trust_calibration_abs is high).
    const trustSamples = cs.trust_calibration_samples ?? 0;
    ctx.trust_calibration_samples = trustSamples;
    if (trustSamples >= 1) {
      ctx.trust_calibration = cs.trust_calibration ?? 0;
      ctx.trust_calibration_abs = Math.abs(cs.trust_calibration ?? 0);
    }
  }
  if (signal.kind === "confidence_declared") {
    ctx.confidence_pre = signal.value;
    // M3: when the meta scene names a concept, expose its FRESHLY-updated calibration so the
    // calibration rule can match on the same turn. updateCalibration has already run in onSignal.
    if (signal.concept_id) {
      const cs = state.concept_states[signal.concept_id] ?? defaultConceptState(signal.concept_id);
      ctx.confidence_calibration = cs.confidence_calibration;             // signed (direction-specific rules)
      ctx.confidence_calibration_abs = Math.abs(cs.confidence_calibration);
      // no gate needed here — recordConfidenceSample ran above, so this branch is measured BY
      // CONSTRUCTION. The count is published all the same, so `calibration_samples` means the same
      // thing on both signal kinds and a bundle rule can be written once. (INT-STUDIUM-029)
      ctx.calibration_samples = cs.calibration_samples ?? 0;
      ctx.total_attempts = cs.total_attempts;
      ctx.mastery_c = masteryOf(cs);
    }
  }
  return ctx;
}

function applyAction(rule: AdaptationRule, signal: Signal): Decision["next_action"] {
  const a = rule.action;
  if (a.kind === "show_calibration_panel") {
    if (signal.kind === "answer_submitted") {
      return { kind: "show_calibration_panel", target_concept: signal.concept_id };
    }
    if (signal.kind === "confidence_declared" && signal.concept_id) {
      return { kind: "show_calibration_panel", target_concept: signal.concept_id };
    }
  }
  return a as Decision["next_action"];
}

export class AdaptationEngine {
  private state: LearnerState;
  private lastDecision: Decision | null = null;

  /** `now` stamps the history entries the FSRS replay later reads. Injected by the session from its
   * clock port so a fixed test clock gives one consistent timeline; defaults to wall-clock. */
  constructor(
    private readonly rules: AdaptationRule[],
    initialState: LearnerState,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.state = JSON.parse(JSON.stringify(initialState));
  }

  onSignal(signal: Signal): Decision {
    if (signal.kind === "answer_submitted") {
      const cs = ensureConceptState(this.state, signal.concept_id);
      // INT-STUDIUM-035 candidate 2: an answer with no `correct` was not graded, so it updates no
      // posterior. It is still recorded as an attempt that happened.
      const afterBeta = signal.correct === undefined ? recordUngradedAttempt(cs) : updateBeta(cs, signal);
      // PER-ANSWER (CONTINUOUS) calibration capture: when the answer carries a self-rated confidence
      // (fed by the confidence-tap UI), fold it into calibration against the POST-answer mastery — the
      // competence the answer just demonstrated — using CALIBRATION_ANSWER_LAMBDA (<1) so accumulated
      // per-answer samples form a RUNNING AVERAGE (not last-write-wins). + counts a sample.
      let next =
        signal.confidence !== undefined
          ? recordConfidenceSample(afterBeta, signal.confidence, CALIBRATION_ANSWER_LAMBDA)
          : afterBeta;
      // JUDGMENT-OVER-ARTIFACT: when the answer is a GROUNDED spot_the_flaw audit (a flawed AI reading
      // of a real executed result), fold trust-in-output-vs-ground-truth into trust_calibration — a
      // dimension DISTINCT from confidence_calibration. This is the north-star destination signal.
      if (signal.judgment_audit?.grounded) {
        next = recordJudgmentAudit(next, signal.judgment_audit);
        // Same audit, SEPARATE signal-detection diagnostic (A' competence + criterion-c bias); no-op
        // unless a real sound class was judged (sound_total>0). Non-gating; complements the signed gap.
        next = recordJudgmentSdt(next, signal.judgment_audit);
      }
      this.state.concept_states[signal.concept_id] = next;
    }
    if (signal.kind === "confidence_declared" && signal.concept_id) {
      // M3: compare declared confidence against the concept's accumulated competence and
      // fold the signed gap into confidence_calibration (+ count the sample, so a calibration GATE
      // can tell measured-and-calibrated from never-measured). Runs BEFORE buildContext so the
      // freshly-written value is visible to the calibration rule on this same turn.
      const cs = ensureConceptState(this.state, signal.concept_id);
      this.state.concept_states[signal.concept_id] = recordConfidenceSample(cs, signal.value);
    }
    if (signal.kind === "scene_completed") {
      if (!this.state.scenes_completed.includes(signal.scene_id)) {
        this.state.scenes_completed.push(signal.scene_id);
      }
    }
    const ctx = buildContext(this.state, signal);
    for (const rule of this.rules) {
      if (matchesCondition(rule.when, ctx)) {
        const decision: Decision = {
          next_action: applyAction(rule, signal),
          rule_id: rule.id,
          explanation_short: rule.explanation_short,
          modulator: rule.modulator,
        };
        this.lastDecision = decision;
        this.state.last_decision = decision;
        this.appendHistory(signal, decision);
        return decision;
      }
    }
    const fallback: Decision = {
      next_action: { kind: "advance_to_next_scene" },
      rule_id: null, explanation_short: null, modulator: null,
    };
    this.lastDecision = fallback;
    this.state.last_decision = fallback;
    this.appendHistory(signal, fallback);
    return fallback;
  }

  private appendHistory(signal: Signal, decision: Decision): void {
    this.state.history.push({
      timestamp: this.now(),
      scene_id: "scene_id" in signal ? signal.scene_id : "",
      signal, decision,
    });
    if (this.state.history.length > 50) this.state.history.shift();
  }

  getState(): LearnerState {
    return JSON.parse(JSON.stringify(this.state));
  }

  explain(): { rule_id: string; explanation_short: string; modulator: string } | null {
    if (!this.lastDecision || !this.lastDecision.rule_id) return null;
    return {
      rule_id: this.lastDecision.rule_id,
      explanation_short: this.lastDecision.explanation_short ?? "",
      modulator: this.lastDecision.modulator ?? "",
    };
  }
}
