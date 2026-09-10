import type { LessonBundle, Scene, ReferenceRun } from "@studium/lesson-bundle-schema";
import { AdaptationEngine, DEFAULT_THETA } from "@studium/adaptation-engine";
import { defaultLearnerState, masteryOf, type LearnerState, type Signal, type Decision } from "@studium/learner-state";
import { buildLwgMastery, buildLwgCalibration, graphAwareNextIndex, firstUnseenAnswerGradedSceneForConcept, sceneConceptId } from "./graph-nav.js";
import type { Presentation, Explanation, LearnerSnapshot, SessionDeps, ResponseInput, Transition, CompletionSummary, HintResult } from "./types.js";
import { enrichEvent, bundleVersionOf, type TelemetryContext, type EmitInput } from "./telemetry.js";
import { SessionNotStartedError, SessionAlreadyCompleteError } from "./errors.js";
import { grade } from "./grading/index.js";
import { thetaForVariant, resolveActiveVariant } from "./universe.js";
import { buildMasteryClaims } from "./mastery-claims.js";
import type { TutorMove } from "./socratic-tutor/types.js";
import { collectBannedAnswers, revealsAnswer } from "./socratic-tutor/reveal.js";
import { FADED_FALLBACK } from "./socratic-tutor/contingency.js";

const ESCALATE_AFTER = 2; // graph remediations in a session before baseline -> remedial escalation

/** How many times ONE scene may be replayed by `replay_current_scene` before the lesson moves on.
 * The rule fires on consecutive errors and the fallback (no unseen alternate item for the concept)
 * is to serve the SAME scene again — which reproduces the same consecutive errors, and fires the
 * same rule. Observed on atomistique-l1: s3c-compare-noeuds replayed to the step limit for a
 * learner whose answers kept grading wrong. A replay is a second chance; an unlimited replay is a
 * dead end, and a lesson nobody can finish teaches nothing. */
export const MAX_SCENE_REPLAYS = 3;
// Mastery-CERTIFICATION bar — the posterior a concept must reach before a `demonstrates_mastery_of`
// claim is emitted. Set to the navigation theta (DEFAULT_THETA=0.8), consistent with the
// buildMasteryClaims unit tests. What separates certification from merely unlocking the next concept
// is NOT a higher posterior but the MIN_MASTERY_ATTEMPTS floor: two clean answers reach alpha-driven
// 0.8 but at only 2 attempts (< floor) so they unlock the next scene WITHOUT certifying mastery. The
// floor (>= 3 distinct attempts) is the anti-fabrication guard; mastery itself certifies at >= 0.8.
const MASTERY_CLAIM_THRESHOLD = DEFAULT_THETA;
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
   * `hintsUsed` (reset per scene-visit) and `state.scenes_replayed` (per scene id), this is the
   * session-lifetime denominator for autonomyRatio. */
  private scaffoldingEvents = 0;
  private activeUniverseId = BASELINE_UNIVERSE_ID;
  protected discussionTurnIdx = 0;
  protected discussionHistory: { role: "learner" | "tutor"; text: string }[] = [];
  protected lastTutorMove: TutorMove | null = null;
  protected lastReasoning: { signal: string; confidence: number } | null = null;
  /** LEARNER-TIME runs captured this session, keyed by task_card_id. A spot_the_flaw scene with
   * `reference_from_run` is grounded on the learner's OWN run (injected by scene()), closing the
   * operation→judgment loop: the learner audits a flawed AI reading of the result THEY produced. */
  private learnerRuns = new Map<string, ReferenceRun>();
  /** Host-set per-scene field overrides (keyed by scene id). Used by per-run REGENERATION: when the
   * learner runs a capsule, the host regenerates a downstream spot_the_flaw's flawed_content/claims/
   * model_correction from the learner's OWN run and sets them here, so both presentation and grading see
   * the regenerated judgment (the regenerated answer key stays server-side — publicScene still strips it). */
  private sceneOverrides = new Map<string, Record<string, unknown>>();

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
  getState(): LearnerState { return this.started ? this.engineStateWithReplays() : this.state; }

  /** The engine's state, with the session's replay tally stamped on. `scenes_replayed` is a
   * declared, persisted field of LearnerState that the ENGINE never writes and the SESSION owns,
   * and `getState()` hands out the engine's object — so anything written into `this.state` alone
   * never reached a caller, a save, or the completion summary. One place stamps it, and every
   * exit from the session goes through here. */
  private engineStateWithReplays(): LearnerState {
    const st = this.engine.getState();
    for (const [sceneId, n] of Object.entries(this.replayCounts)) st.scenes_replayed[sceneId] = n;
    return st;
  }

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

  /** Record a learner-time run (the learner's OWN executed result) for a capsule, keyed by task_card_id.
   * A later spot_the_flaw scene with `reference_from_run === taskCardId` is then grounded on it. Called
   * by the host after it ingests the operator's run_result.json (the run protocol). */
  recordLearnerRun(taskCardId: string, run: ReferenceRun): void {
    this.learnerRuns.set(taskCardId, run);
  }

  /** Override fields on a scene (by id) — used by per-run REGENERATION (the host regenerates a
   * spot_the_flaw's flawed_content/claims/model_correction from the learner's run). Merged in scene(). */
  setSceneOverride(sceneId: string, override: Record<string, unknown>): void {
    this.sceneOverrides.set(sceneId, { ...(this.sceneOverrides.get(sceneId) ?? {}), ...override });
  }

  // --- protected helpers shared with respond()/submitTurn() (Tasks 8–10) ---
  protected scene(): Scene {
    let s = this.bundle.scenes[this.idx] as Scene;
    // PER-RUN REGENERATION: a host-set override (regenerated from the learner's run) merges FIRST, so
    // both presentation and grading see the regenerated flawed_content/claims/model_correction.
    const override = this.sceneOverrides.get(s.id);
    if (override) s = { ...s, ...override } as Scene;
    // LEARNER-RUN GROUNDING: a spot_the_flaw with reference_from_run audits a flawed reading of the
    // learner's OWN run — inject the recorded run as reference_result so BOTH the surfaced evidence AND
    // the grader (judgment_audit -> trust_calibration) see the learner's result. No run -> authored scene.
    if (s.type === "spot_the_flaw" && s.reference_from_run) {
      const run = this.learnerRuns.get(s.reference_from_run);
      if (run) return { ...s, reference_result: run };
    }
    return s;
  }
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
      ...(this.deps.auditJudge ? { auditJudge: this.deps.auditJudge } : {}),
      ...(bloomLevel ? { bloomLevel } : {}),
    });
    for (const ev of telemetry) this.emit(ev);
    const decision = await this.applySignal(signal);                 // drives navigation
    if (signal.kind !== "scene_completed") {
      await this.applySignal({ kind: "scene_completed", scene_id: scene.id, duration_ms: 0 }); // bookkeeping only
    }
    const success = this.successOf(signal);
    this.emit({ type: "scene_completed", scene_id: scene.id, duration_ms: 0, ...(success === undefined ? {} : { success }) });
    return this.navigate(decision, scene);
  }

  protected async applySignal(signal: Signal): Promise<Decision> {
    const decision = this.engine.onSignal(signal);
    this.state = this.engineStateWithReplays();
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

  /** Prerequisite detours spent per concept id, this session — the budget that makes the
   * prereq gate terminate for a learner whose mastery never rises (see graph-nav's
   * MAX_PREREQ_DETOURS). Session-scoped: a fresh session gets a fresh budget. */
  private prereqDetours: Record<string, number> = {};

  /** Same-scene replays spent per scene id, this session — the budget behind MAX_SCENE_REPLAYS.
   * SESSION-owned on purpose: `state.scenes_replayed` belongs to the engine, which hands back its
   * own object on every `getState()`, so a tally written straight into it is overwritten on the
   * next signal and never passes 1. This counter accumulates, and `applySignal` projects it onto
   * the state before every save — so the persisted field finally holds the real count. */
  private replayCounts: Record<string, number> = {};

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
      // no unseen alternate -> honest fallback: replay the same item, while the budget lasts.
      // Counted ONCE, in the session-owned tally; applySignal projects it onto
      // `state.scenes_replayed` before each save, and `scaffoldingEvents` feeds autonomyRatio.
      if ((this.replayCounts[scene.id] ?? 0) < MAX_SCENE_REPLAYS) {
        this.replayCounts[scene.id] = (this.replayCounts[scene.id] ?? 0) + 1;
        this.scaffoldingEvents += 1;
        return { kind: "replay", reason: action.reason, presentation: this.currentPresentation() };
      }
      // Budget spent: stop re-serving the same scene and FALL THROUGH to the normal advance below.
      // Announced, not silent — the learner leaves this scene without getting it right, and that is
      // exactly what the teacher needs to see.
      this.lastGraphExplanation = { rule_id: "replay_budget_exhausted", explanation_short: "revu plusieurs fois sans succès — on avance", modulator: "M1" };
      this.emit({ type: "adaptation_applied", rule_id: "replay_budget_exhausted", signal: "navigate", modulator: "M1", value: 0 });
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
      // End-of-lesson self-check: no next scene to host a standalone calibration
      // transition, so surface the M3 feedback on the completion instead of dropping it.
      if (this.idx + 1 >= this.bundle.scenes.length) return this.complete({ targetConcept: target });
      this.idx += 1; this.enterScene();
      return { kind: "calibration", targetConcept: target, presentation: this.currentPresentation() };
    }
    // advance_to_next_scene | show_explanation_panel | fallback
    const lwg = this.bundle.learning_workflow_graph;
    if (lwg) {
      const { index: nextIdx, reason } = graphAwareNextIndex(
        this.bundle.scenes, this.idx, lwg,
        buildLwgMastery(this.state.concept_states), this.theta, this.skipMastered,
        buildLwgCalibration(this.state.concept_states),
        this.prereqDetours,
      );
      if (nextIdx === null) return this.complete();
      this.idx = nextIdx;
      this.enterScene();
      if (reason === "remediate") {
        this.lastGraphExplanation = { rule_id: "graph_prereq_gate", explanation_short: "prerequisite not yet mastered — routed to remediation", modulator: "M6" };
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate", signal: "navigate", modulator: "M6", value: 0 });
        this.remediationCount += 1;
        this.scaffoldingEvents += 1; // a prerequisite remediation detour is scaffolding the learner relied on
        // Spend one unit of THIS prerequisite's detour budget. Keyed on the concept we were routed
        // TO (the unmet prereq), which is the concept the gate is waiting on — not the gated one.
        const detoured = sceneConceptId(this.bundle.scenes[nextIdx] as { concept_refs?: string[] });
        if (detoured) this.prereqDetours[detoured] = (this.prereqDetours[detoured] ?? 0) + 1;
        this.maybeEscalateUniverse();
      } else if (reason === "gate_released") {
        // The budget is spent and the learner is let into the gated scene WITHOUT the prerequisite.
        // Announced rather than silent: an unmastered pass is a thing the teacher must be able to
        // see, and it is the only alternative to a lesson that never ends.
        this.lastGraphExplanation = { rule_id: "graph_prereq_gate_released", explanation_short: "prerequisite still unmastered after repeated remediation — advancing anyway", modulator: "M6" };
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate_released", signal: "navigate", modulator: "M6", value: 0 });
      } else if (reason === "gate_unassessable") {
        // INT-STUDIUM-037. The prerequisite is unmet and the lesson holds no scene the router can
        // send the learner back to, so the gate opens on the first try. Before this it was reported
        // as a plain advance — indistinguishable from an ordinary next step — and on the real
        // atomistique-l1 bundle it happens FOUR times to a learner who has mastered nothing, while
        // graph_prereq_gate_released fires zero times. Its own rule_id, not the release's: the
        // release says the learner did not manage it after three tries, this says the bundle gave
        // them nothing to try. The second is an authoring defect and the teacher is the one who can
        // fix it.
        this.lastGraphExplanation = { rule_id: "graph_prereq_unassessable", explanation_short: "prerequisite unmet and no scene can assess it — advancing anyway", modulator: "M6" };
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_unassessable", signal: "navigate", modulator: "M6", value: 0 });
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
    this.discussionHistory = [];
    this.hintsUsed = 0;
    this.emit({ type: "scene_entered", scene_id: this.scene().id, scene_type: this.scene().type });
  }

  protected complete(calibration?: { targetConcept: string }): Transition {
    this.completed = true;
    const totalDurationMs = Math.max(0, Date.parse(this.deps.clock.now()) - Date.parse(this.startIso));
    const completed = this.state.scenes_completed.length;
    // autonomyRatio measures how much the learner completed WITHOUT leaning on scaffolding.
    // Its operator-facing name is SCAFFOLDING INDEPENDENCE (INT-STUDIUM-023,
    // `tools/class_report.py:AUTONOMY_INDICATOR_NAME`, which publishes the mean of these as
    // `mean_autonomy`). The analytics collector computes a DIFFERENT measurement under the
    // same wire key `autonomy_ratio` — AI critiques over critiques plus hints, over a whole
    // course's events ("critique-over-hint balance",
    // `services/analytics-collector/metrics.py:AUTONOMY_INDICATOR_NAME`). The wire key is
    // not renamed: historical telemetry carries it, and both numbers are real.
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
    const summary: CompletionSummary = { totalDurationMs, autonomyRatio, scenesCompleted: completed, finalState: this.engineStateWithReplays() };
    this.emit({ type: "lesson_completed", total_duration_ms: totalDurationMs, autonomy_ratio: autonomyRatio });
    if (this.deps.masteryClaimSink) {
      const doc = buildMasteryClaims(this.engineStateWithReplays(), {
        pseudonym: this.pseudonym,
        sessionId: this.sessionId,
        bundleId: this.bundle.bundle_id,
        activeUniverseId: this.activeUniverseId,
        threshold: MASTERY_CLAIM_THRESHOLD,
      });
      if (doc["@graph"].length > 0) this.deps.masteryClaimSink.emit(doc);
    }
    return { kind: "complete", summary, ...(calibration ? { calibration } : {}) };
  }

  /** Whether the scene was answered CORRECTLY, or `undefined` when nobody graded it.
   *
   * A non-answer scene (intro, concept, discussion, meta) completes successfully by definition. An
   * answered one reports what the grader said — and since INT-STUDIUM-035 candidate 2 the offline
   * substring matcher says nothing, so this is `undefined` and `scene_completed` goes out WITHOUT
   * `success`. `true` would certify through the telemetry the exact claim the decision withdrew from
   * the posterior, and `false` would libel the learner. */
  protected successOf(signal: Signal): boolean | undefined {
    return signal.kind === "answer_submitted" ? signal.correct : true;
  }

  /** The last tutor reply the LEARNER saw (faded fallback if a reveal was blocked), or null. */
  getLastTutorMove(): TutorMove | null { return this.lastTutorMove; }
  getLastReasoning(): { signal: string; confidence: number } | null { return this.lastReasoning; }

  async submitTurn(text: string): Promise<void> {
    this.assertStarted();
    const scene = this.scene();
    if (scene.type !== "discussion") return;            // no-op outside discussion
    if (this.discussionTurnIdx >= scene.max_turns) return;
    const turnIndex = this.discussionTurnIdx++;
    const result = await this.deps.reasoningScorer.score(text, scene.topic);
    if (result === null) return;                        // graceful degradation
    this.lastReasoning = { signal: result.signal, confidence: result.confidence };
    this.emit({ type: "reasoning_signal", scene_id: scene.id, signal: result.signal, confidence: result.confidence, turn_index: turnIndex });

    // EV-3a: live Socratic tutor (optional dep = flag). Telemetry-only; submitTurn stays void.
    if (!this.deps.socraticTutor) return;
    this.discussionHistory.push({ role: "learner", text });
    const move = await this.deps.socraticTutor.respond({
      topic: scene.topic, seedClaim: scene.seed_claim, learnerTurn: text,
      signal: result.signal, confidence: result.confidence, history: this.discussionHistory,
    });
    if (move === null) return;
    const banned = collectBannedAnswers(this.bundle, scene);
    const lowConfViolation = result.confidence < 0.4 && move.move_kind !== "scaffold_hint";
    const revealed = move.revealed || revealsAnswer(move.text, banned) || lowConfViolation;
    const safe = revealed ? FADED_FALLBACK[result.signal] : move;
    this.discussionHistory.push({ role: "tutor", text: safe.text });
    this.lastTutorMove = safe; // the learner-facing move
    this.emit({
      type: "tutor_move", scene_id: scene.id,
      move_kind: move.move_kind,          // ORIGINAL move (eval honesty)
      in_reply_to_signal: result.signal,
      revealed, reveal_blocked: revealed, turn_index: turnIndex,
    });
  }
}

function decisionValue(signal: Signal): number {
  if (signal.kind === "answer_submitted") return signal.difficulty;
  if (signal.kind === "confidence_declared") return signal.value;
  return 0;
}
