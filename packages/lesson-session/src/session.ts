import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";
import { AdaptationEngine, DEFAULT_THETA } from "@studium/adaptation-engine";
import { defaultLearnerState, masteryOf, type LearnerState, type Signal, type Decision } from "@studium/learner-state";
import { buildLwgMastery, graphAwareNextIndex, firstUnseenAnswerGradedSceneForConcept } from "./graph-nav.js";
import type { Presentation, Explanation, LearnerSnapshot, SessionDeps, ResponseInput, Transition, CompletionSummary, HintResult } from "./types.js";
import { enrichEvent, bundleVersionOf, type TelemetryContext, type EmitInput } from "./telemetry.js";
import { SessionNotStartedError, SessionAlreadyCompleteError } from "./errors.js";
import { grade } from "./grading/index.js";
import { thetaForVariant, resolveActiveVariant } from "./universe.js";
import { buildMasteryClaims } from "./mastery-claims.js";

const ESCALATE_AFTER = 2; // graph remediations in a session before baseline -> remedial escalation
const MASTERY_CLAIM_THRESHOLD = 0.8; // fixed mastery-CLAIM bar (NOT the lowerable navigation theta)
const BASELINE_UNIVERSE_ID = "baseline";
const REMEDIAL_UNIVERSE_ID = "remedial";

export class LessonSession {
  private engine!: AdaptationEngine;
  private idx = 0;
  private started = false;
  private completed = false;
  private startIso = "";
  private ctx!: TelemetryContext;
  private sessionId = "";
  private pseudonym = "";
  private theta = DEFAULT_THETA;
  private skipMastered = false;
  private scaffolding: "standard" | "heavy" = "standard";
  private hintsUsed = 0;
  private lastGraphExplanation: Explanation | null = null;
  private remediationCount = 0;
  /** Cumulative count of scaffolding events the learner leaned on across the whole session:
   * +1 per hint dispensed, +1 per scene replay, +1 per prerequisite remediation. Unlike
   * `hintsUsed` (reset per scene-visit) and `state.scenes_replayed` (never written by the engine),
   * this is the session-lifetime denominator for autonomyRatio. */
  private scaffoldingEvents = 0;
  private activeUniverseId = BASELINE_UNIVERSE_ID;
  protected discussionTurnIdx = 0;

  constructor(
    private readonly bundle: LessonBundle,
    private readonly deps: SessionDeps,
    private state: LearnerState = defaultLearnerState(bundle.bundle_id),
    /** RGPD (#4): salts the pseudonym so distinct learners on the same lesson get distinct
     * pseudonyms. Defaults to "anonymous" so callers/tests that omit it still compile and stay
     * deterministic. */
    private readonly learnerId: string = "anonymous",
  ) {}

  async start(): Promise<Presentation> {
    this.sessionId = this.deps.idGen.uuid();
    this.pseudonym = await this.deps.pseudonym.get(this.learnerId, this.bundle.bundle_id);
    this.ctx = { learnerPseudonym: this.pseudonym, lessonId: this.bundle.bundle_id, bundleVersion: bundleVersionOf(this.bundle) };
    this.engine = new AdaptationEngine(this.bundle.rules, this.state);
    this.state = this.engine.getState();
    this.startIso = this.deps.clock.now();
    this.started = true;
    const u = this.bundle.universes ?? null;
    const activeId = this.deps.activeUniverseSelector?.(this.bundle) ?? u?.active ?? BASELINE_UNIVERSE_ID;
    const variant = resolveActiveVariant(u, activeId);
    this.theta = thetaForVariant(variant);
    this.skipMastered = variant?.decisions?.["pacing"] === "skip_on_mastery";
    this.scaffolding = variant?.decisions?.["scaffolding"] === "heavy" ? "heavy" : "standard";
    this.activeUniverseId = activeId;
    if (variant) {
      this.emit({ type: "universe_selected", universe_id: variant.id, active_decisions: variant.decisions });
    }
    this.emit({ type: "lesson_started", bundle_uri: this.bundle.bundle_id });
    this.emit({ type: "scene_entered", scene_id: this.scene().id, scene_type: this.scene().type });
    return this.currentPresentation();
  }

  currentPresentation(): Presentation {
    this.assertStarted();
    return {
      scene: this.scene(),
      index: this.idx,
      total: this.bundle.scenes.length,
      lastDecision: this.state.last_decision,
      explanation: this.explainLast(),
      learnerSnapshot: this.snapshot(),
    };
  }

  explainLast(): Explanation | null {
    if (!this.started) return null;
    return this.lastGraphExplanation ?? this.engine.explain();
  }
  getState(): LearnerState { return this.started ? this.engine.getState() : this.state; }

  /** The session's resolved pseudonym (salted on learnerId+lessonId). Empty until start(). Used by
   * the host to label the forget_requested event without re-deriving the salt. */
  getPseudonym(): string { return this.pseudonym; }

  /** RGPD erasure (#4): purge every store this session wrote the learner's personal data to —
   * StateStore (BKT mastery), MasteryClaimSink (.jsonld), EventLog (append log), Telemetry.
   * Optional port methods are `?.`-guarded so adapters that don't implement them are skipped. */
  async erase(): Promise<void> {
    await this.deps.stateStore.delete?.(this.bundle.bundle_id);
    await this.deps.masteryClaimSink?.erase?.();
    await this.deps.eventLog.purge?.();
    await this.deps.telemetry.purge?.();
  }

  /** Pull the next authored hint for the current quiz scene (scaffolding-gated).
   * standard -> at most 1 hint; heavy -> all authored hints. Returns null when not a
   * quiz, no hints, or the cap is reached. Each hint increments hint_count, which
   * discounts mastery credit on the eventual answer (M5 anti-offloading). */
  requestHint(): HintResult | null {
    this.assertStarted();
    const scene = this.scene();
    if (scene.type !== "quiz" || scene.hints.length === 0) return null;
    const cap = this.scaffolding === "heavy" ? scene.hints.length : Math.min(1, scene.hints.length);
    if (this.hintsUsed >= cap) return null;
    const index = this.hintsUsed;
    const hint = scene.hints[index]!;
    this.emit({ type: "hint_requested", scene_id: scene.id, hint_index: index });
    this.hintsUsed += 1;
    this.scaffoldingEvents += 1; // each dispensed hint is a unit of scaffolding the learner consumed
    return { hint, index, remaining: cap - this.hintsUsed };
  }

  // --- protected helpers shared with respond()/submitTurn() (Tasks 8–10) ---
  protected scene(): Scene { return this.bundle.scenes[this.idx] as Scene; }
  protected assertStarted(): void { if (!this.started) throw new SessionNotStartedError(); }
  protected emit(partial: EmitInput): void {
    this.deps.telemetry.emit(enrichEvent(partial, this.ctx, this.deps.clock, this.deps.idGen));
  }
  private snapshot(): LearnerSnapshot {
    const conceptMastery: Record<string, number> = {};
    for (const [id, cs] of Object.entries(this.state.concept_states)) conceptMastery[id] = masteryOf(cs);
    return { conceptMastery, scenesCompleted: this.state.scenes_completed.length };
  }

  /** One-way escalation: after repeated prerequisite remediation, switch the active universe
   * baseline -> remedial (lower theta, more support). Never de-escalates. */
  private maybeEscalateUniverse(): void {
    if (this.remediationCount < ESCALATE_AFTER) return;
    if (this.activeUniverseId !== BASELINE_UNIVERSE_ID) return;
    const remedial = resolveActiveVariant(this.bundle.universes ?? null, REMEDIAL_UNIVERSE_ID);
    if (!remedial) return;
    this.activeUniverseId = REMEDIAL_UNIVERSE_ID;
    this.theta = thetaForVariant(remedial);
    // the remedial variant may set its own pacing (e.g. could enable skip) — recompute on switch
    this.skipMastered = remedial.decisions?.["pacing"] === "skip_on_mastery";
    this.scaffolding = remedial.decisions?.["scaffolding"] === "heavy" ? "heavy" : "standard";
    this.lastGraphExplanation = { rule_id: "graph_universe_escalated", explanation_short: "repeated remediation — escalated to the remedial universe", modulator: "M6" };
    this.emit({ type: "universe_selected", universe_id: remedial.id, active_decisions: remedial.decisions });
    this.emit({ type: "adaptation_applied", rule_id: "graph_universe_escalated", signal: "navigate", modulator: "M6", value: 0 });
  }

  async respond(input: ResponseInput): Promise<Transition> {
    this.assertStarted();
    if (this.completed) throw new SessionAlreadyCompleteError();
    const scene = this.scene();
    // M1: look up the scene concept's Bloom target from the bundle so grade() can derive
    // the IRT difficulty `w` from it (mirrors how hintCount is threaded). Absent -> grader fallback.
    const conceptId = "concept_refs" in scene ? scene.concept_refs[0] : undefined;
    const bloomLevel = conceptId ? this.bundle.concepts.find((c) => c.id === conceptId)?.bloom_level_target : undefined;
    const { signal, telemetry } = await grade(scene, input, {
      critiqueEvaluator: this.deps.critiqueEvaluator, hintCount: this.hintsUsed,
      ...(bloomLevel ? { bloomLevel } : {}),
    });
    for (const ev of telemetry) this.emit(ev);
    const decision = await this.applySignal(signal);                 // drives navigation
    if (signal.kind !== "scene_completed") {
      await this.applySignal({ kind: "scene_completed", scene_id: scene.id, duration_ms: 0 }); // bookkeeping only
    }
    this.emit({ type: "scene_completed", scene_id: scene.id, duration_ms: 0, success: this.successOf(signal) });
    return this.navigate(decision, scene);
  }

  protected async applySignal(signal: Signal): Promise<Decision> {
    const decision = this.engine.onSignal(signal);
    this.state = this.engine.getState();
    await this.deps.stateStore.save(this.bundle.bundle_id, this.state);
    await this.deps.eventLog.append({
      event_id: this.deps.idGen.uuid(),
      session_id: this.sessionId,
      pseudonyme: this.pseudonym,
      lesson_id: this.bundle.bundle_id,
      schema_version: "1.0",
      timestamp: this.deps.clock.now(),
      event_type: signal.kind,
      payload: { ...signal, decision: { rule_id: decision.rule_id, modulator: decision.modulator, action: decision.next_action } },
    });
    if (decision.rule_id && decision.modulator) {
      this.emit({ type: "adaptation_applied", rule_id: decision.rule_id, signal: signal.kind, modulator: decision.modulator, value: decisionValue(signal) });
    }
    return decision;
  }

  protected navigate(decision: Decision, scene: Scene): Transition {
    this.lastGraphExplanation = null;
    const action = decision.next_action;
    if (action.kind === "replay_current_scene") {
      this.hintsUsed = 0; // hints are per-scene-visit: a replay grants a fresh budget. Farming (hint then deliberate-wrong then replay then unhinted-correct) is self-defeating — the wrong answer's beta penalty dominates the dodged discount.
      // Prefer routing remediation to an UNSEEN alternate item for the same concept (#1: avoids the
      // penalized same-scene replay). sceneConceptId() returns the `concept:`-prefixed LWG node id,
      // so prefix the scene's first concept_ref to match. scenes_completed already includes the
      // just-answered scene, so the current item never counts as "unseen".
      const concept = "concept_refs" in scene ? `concept:${scene.concept_refs[0] ?? ""}` : "";
      const seen = new Set(this.state.scenes_completed);
      const altIdx = firstUnseenAnswerGradedSceneForConcept(this.bundle.scenes, concept, seen);
      if (altIdx >= 0) {
        // present an UNSEEN alternate item for the same concept (different-item remediation)
        this.scaffoldingEvents += 1; // remediation is still a scaffold the learner relied on
        this.idx = altIdx;
        this.enterScene();
        return { kind: "remediate_alt", reason: action.reason, presentation: this.currentPresentation() };
      }
      // no unseen alternate -> honest fallback: replay the same item.
      // Record the replay both per-scene (state.scenes_replayed — previously never written) and in the
      // session-lifetime scaffolding tally that feeds autonomyRatio.
      this.state.scenes_replayed[scene.id] = (this.state.scenes_replayed[scene.id] ?? 0) + 1;
      this.scaffoldingEvents += 1;
      return { kind: "replay", reason: action.reason, presentation: this.currentPresentation() };
    }
    if (action.kind === "skip_to_next_concept") {
      // NOTE: engine-fired explicit actions (skip/calibration) take priority over LWG prereq gating.
      const currentConcept = "concept_refs" in scene ? (scene.concept_refs[0] ?? "") : "";
      const next = this.bundle.scenes.findIndex((s, i) =>
        i > this.idx && ("concept_refs" in s ? (s.concept_refs[0] ?? "") : "") !== currentConcept);
      if (next >= 0) { this.idx = next; this.enterScene(); return { kind: "next", presentation: this.currentPresentation() }; }
      // no later scene with a different concept — fall through to advance/complete
    }
    if (action.kind === "show_calibration_panel") {
      // NOTE: engine-fired explicit actions (skip/calibration) take priority over LWG prereq gating.
      const target = action.target_concept;
      if (this.idx + 1 >= this.bundle.scenes.length) return this.complete();
      this.idx += 1; this.enterScene();
      return { kind: "calibration", targetConcept: target, presentation: this.currentPresentation() };
    }
    // advance_to_next_scene | show_explanation_panel | fallback
    const lwg = this.bundle.learning_workflow_graph;
    if (lwg) {
      const { index: nextIdx, reason } = graphAwareNextIndex(
        this.bundle.scenes, this.idx, lwg,
        buildLwgMastery(this.state.concept_states), this.theta, this.skipMastered,
      );
      if (nextIdx === null) return this.complete();
      this.idx = nextIdx;
      this.enterScene();
      if (reason === "remediate") {
        this.lastGraphExplanation = { rule_id: "graph_prereq_gate", explanation_short: "prerequisite not yet mastered — routed to remediation", modulator: "M6" };
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate", signal: "navigate", modulator: "M6", value: 0 });
        this.remediationCount += 1;
        this.scaffoldingEvents += 1; // a prerequisite remediation detour is scaffolding the learner relied on
        this.maybeEscalateUniverse();
      } else if (reason === "skip_mastered") {
        this.lastGraphExplanation = { rule_id: "graph_skip_mastered", explanation_short: "concept already mastered — skipped", modulator: "M1" };
        this.emit({ type: "adaptation_applied", rule_id: "graph_skip_mastered", signal: "navigate", modulator: "M1", value: 0 });
      }
      return { kind: "next", presentation: this.currentPresentation() };
    }
    if (this.idx + 1 >= this.bundle.scenes.length) return this.complete();
    this.idx += 1; this.enterScene();
    return { kind: "next", presentation: this.currentPresentation() };
  }

  protected enterScene(): void {
    this.discussionTurnIdx = 0;
    this.hintsUsed = 0;
    this.emit({ type: "scene_entered", scene_id: this.scene().id, scene_type: this.scene().type });
  }

  protected complete(): Transition {
    this.completed = true;
    const totalDurationMs = Math.max(0, Date.parse(this.deps.clock.now()) - Date.parse(this.startIso));
    const completed = this.state.scenes_completed.length;
    // autonomyRatio measures how much the learner completed WITHOUT leaning on scaffolding.
    // Formula: completed / (completed + scaffoldingEvents), clamped to [0,1].
    //   scaffoldingEvents = #hints dispensed + #scene replays + #prerequisite remediations
    //     (cumulative over the whole session; see `this.scaffoldingEvents`).
    //   - no scaffolding            → completed/completed            = 1.0  (fully independent)
    //   - more scaffolding consumed → larger denominator             → strictly lower, monotone
    //   - bounded in [0,1]; denom==0 (degenerate empty session)      → 1.0
    // Previously this read state.scenes_replayed (NEVER written → always 0) and ignored hints +
    // remediations entirely, so it pinned to 1.0 for every learner — the bug this fix removes.
    const scaffolding = this.scaffoldingEvents;
    const denom = completed + scaffolding;
    const autonomyRatio = denom === 0 ? 1 : Math.max(0, Math.min(1, completed / denom));
    const summary: CompletionSummary = { totalDurationMs, autonomyRatio, scenesCompleted: completed, finalState: this.engine.getState() };
    this.emit({ type: "lesson_completed", total_duration_ms: totalDurationMs, autonomy_ratio: autonomyRatio });
    if (this.deps.masteryClaimSink) {
      const doc = buildMasteryClaims(this.engine.getState(), {
        pseudonym: this.pseudonym,
        sessionId: this.sessionId,
        bundleId: this.bundle.bundle_id,
        activeUniverseId: this.activeUniverseId,
        threshold: MASTERY_CLAIM_THRESHOLD,
      });
      if (doc["@graph"].length > 0) this.deps.masteryClaimSink.emit(doc);
    }
    return { kind: "complete", summary };
  }

  protected successOf(signal: Signal): boolean {
    return signal.kind === "answer_submitted" ? signal.correct : true;
  }

  async submitTurn(text: string): Promise<void> {
    this.assertStarted();
    const scene = this.scene();
    if (scene.type !== "discussion") return;            // no-op outside discussion
    if (this.discussionTurnIdx >= scene.max_turns) return;
    const turnIndex = this.discussionTurnIdx++;
    const result = await this.deps.reasoningScorer.score(text, scene.topic);
    if (result === null) return;                        // graceful degradation
    this.emit({ type: "reasoning_signal", scene_id: scene.id, signal: result.signal, confidence: result.confidence, turn_index: turnIndex });
  }
}

function decisionValue(signal: Signal): number {
  if (signal.kind === "answer_submitted") return signal.difficulty;
  if (signal.kind === "confidence_declared") return signal.value;
  return 0;
}
