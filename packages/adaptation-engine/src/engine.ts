import type { LearnerState, ConceptState, Signal, Decision } from "@studium/learner-state";
import { defaultConceptState, updateCalibration } from "@studium/learner-state";
import type { AdaptationRule } from "@studium/lesson-bundle-schema";
import { updateBeta } from "./beta-updater";
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
    ctx.answer_correct = signal.correct;
    ctx.hint_count = signal.hint_count;
    ctx.time_on_scene = signal.time_ms / 1000;
    ctx.consecutive_errors_same_concept = cs.consecutive_errors;
    ctx.mastery_c = masteryOf(cs);
    ctx.total_attempts = cs.total_attempts;
    ctx.total_correct = cs.total_correct;
    ctx.confidence_calibration_abs = Math.abs(cs.confidence_calibration);
  }
  if (signal.kind === "confidence_declared") {
    ctx.confidence_pre = signal.value;
    // M3: when the meta scene names a concept, expose its FRESHLY-updated calibration so the
    // calibration rule can match on the same turn. updateCalibration has already run in onSignal.
    if (signal.concept_id) {
      const cs = state.concept_states[signal.concept_id] ?? defaultConceptState(signal.concept_id);
      ctx.confidence_calibration = cs.confidence_calibration;             // signed (direction-specific rules)
      ctx.confidence_calibration_abs = Math.abs(cs.confidence_calibration);
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

  constructor(private readonly rules: AdaptationRule[], initialState: LearnerState) {
    this.state = JSON.parse(JSON.stringify(initialState));
  }

  onSignal(signal: Signal): Decision {
    if (signal.kind === "answer_submitted") {
      const cs = ensureConceptState(this.state, signal.concept_id);
      this.state.concept_states[signal.concept_id] = updateBeta(cs, signal);
    }
    if (signal.kind === "confidence_declared" && signal.concept_id) {
      // M3: compare declared confidence against the concept's accumulated competence and
      // fold the signed gap into confidence_calibration. Runs BEFORE buildContext so the
      // freshly-written value is visible to the calibration rule on this same turn.
      const cs = ensureConceptState(this.state, signal.concept_id);
      this.state.concept_states[signal.concept_id] = updateCalibration(cs, signal.value);
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
      timestamp: new Date().toISOString(),
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
