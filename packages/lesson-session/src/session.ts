import type { LessonBundle, Scene, ReferenceRun } from "@studium/lesson-bundle-schema";
import { AdaptationEngine, DEFAULT_THETA, type SelfRating } from "@studium/adaptation-engine";
import type { TelemetryEvent } from "@studium/telemetry-events";
import { defaultLearnerState, masteryOf, type LearnerState, type PendingDetourState, type Signal, type Decision } from "@studium/learner-state";
import { ANSWER_GRADED_TYPES, buildLwgMastery, buildLwgEffectiveMastery, buildLwgCalibration, graphAwareNextIndex, firstUnseenAnswerGradedSceneForConcept, sceneConceptId, type GraphNavResult } from "./graph-nav.js";
import type { Presentation, Explanation, LearnerSnapshot, SessionDeps, ResponseInput, Transition, CompletionSummary, HintResult, Verdict, Navigation } from "./types.js";
import { enrichEvent, bundleVersionOf, type TelemetryContext, type EmitInput } from "./telemetry.js";
import { SessionError, SessionNotStartedError, SessionAlreadyCompleteError, SelfRatingNotRequestedError, SelfRatingExpiredError, InvalidSelfRatingError } from "./errors.js";
import { grade } from "./grading/index.js";
import { thetaForVariant, resolveActiveVariant } from "./universe.js";
import { buildMasteryClaims } from "./mastery-claims.js";
import type { TutorMove } from "./socratic-tutor/types.js";
import { collectBannedAnswers, revealsAnswer } from "./socratic-tutor/reveal.js";
import { fadedFallback } from "./socratic-tutor/contingency.js";
import type { GradeDetail, JudgedCoverage } from "./grading/graders.js";
import { isSelfRating, fsrsGradeOf, selfRatingRequest, type SelfRatingRecord, type SelfRatingRequest } from "./self-rating.js";
import { localeFromLanguage, phrase, type Locale } from "./phrases.js";

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

/** One served step of a session: an answer (graded or not) or an acknowledged scene. */
export interface PathStep {
  step: number;
  scene_id: string;
  /** The learner submitted an answer; false for an acknowledged scene. */
  answered: boolean;
  /** true / false when a key or a judge assessed the answer, null otherwise. */
  correct: boolean | null;
  /** Who assessed the answer. Absent for an acknowledged scene and for a step rebuilt from history. */
  assessed_by?: Verdict["assessed_by"];
  /** How the session routed after this step. Absent for a step rebuilt from the saved history. */
  navigation?: { kind: Navigation["kind"]; rule_id: string | null; returns_to?: string };
}
export interface LearnerPath { steps: PathStep[]; passed_prerequisites: string[] }
/** What an answered step adds for a map that shows its evidence: when the answer was given (the
 * session clock), the hints taken on that visit before it, and whether the learner then rated their
 * own recall. Read beside the path, by `step`. A self-rating is not in the saved history: a session
 * resumed after a restart no longer knows it. */
export interface AnswerFact { step: number; scene_id: string; at: string; hints: number; self_rated: boolean }
/** A learner's declaration on a concept (« I know it », « I am not sure ») and what the check questions
 * that followed showed (INT-STUDIUM-058 § 2.7). Scene ids and results only: none of the learner's words. */
export interface ContestRecord {
  concept_id: string;
  claim: "known" | "unsure";
  outcome: "confirmed" | "refuted" | "partial";
  scene_ids: string[];
  results: boolean[];
}

/** The saved history holds, per answered step, the answer and then the scene's completion: fold the
 * pair into one step. The history is capped, so a long session resumes with its latest steps only. */
function trailFromHistory(history: LearnerState["history"]): { trail: PathStep[]; facts: AnswerFact[] } {
  const trail: PathStep[] = [];
  const facts: AnswerFact[] = [];
  for (const entry of history) {
    const last = trail.at(-1);
    if (entry.signal.kind === "answer_submitted") {
      trail.push({ step: trail.length + 1, scene_id: entry.scene_id, answered: true,
        correct: typeof entry.signal.correct === "boolean" ? entry.signal.correct : null });
      facts.push({ step: trail.length, scene_id: entry.scene_id, at: entry.timestamp, hints: entry.signal.hint_count, self_rated: false });
    } else if (entry.signal.kind === "scene_completed" && !(last?.answered && last.scene_id === entry.scene_id)) {
      trail.push({ step: trail.length + 1, scene_id: entry.scene_id, answered: false, correct: null });
    }
  }
  return { trail, facts };
}

export class LessonSession {
  /** Shared localization seam for consumers that only depend on the public LessonSession class. */
  static readonly phrase = phrase;
  static readonly localeFromLanguage = localeFromLanguage;

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
  private showHintsAvailable = false;
  private lastGraphExplanation: Explanation | null = null;
  private activeNavigationExplanation: Explanation | null = null;
  private remediationCount = 0;
  /** Prerequisites (LWG `concept:` ids) whose gate was passed this session; never re-gated. */
  private passedPrerequisites = new Set<string>();
  /** The prerequisite a graph detour is currently serving an item for, until the next routing. */
  private graphDetourPrerequisite: string | undefined;
  private announcedUnassessablePrerequisites = new Set<string>();
  private detourCounts: Record<string, number> = {};
  private pendingDetourReturnIdx: number | undefined;
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
  /** Epoch ms at which the current scene was entered: the client_timestamp of its scene_entered
   * event, so measuring time on scene costs no extra clock read (RT-8). NaN before any entry. */
  private sceneEnteredAtMs = Number.NaN;
  /** C4: scenes whose last answer asked for a self-rating not given yet, with the concepts it rates.
   * L-9: restored from, and saved with, the LearnerState (`self_rating_requests`). */
  private pendingSelfRatings = new Map<string, { conceptIds: string[]; requestedAt: string }>();
  /** L-9: scenes whose last answer asked for a self-rating in a state saved by a server that kept the
   * request in memory only (no `self_rating_requests` field): the request expired with that process. */
  private expiredSelfRatings = new Set<string>();
  private readonly locale: Locale;

  constructor(
    private readonly bundle: LessonBundle,
    private readonly deps: SessionDeps,
    private state: LearnerState = defaultLearnerState(bundle.bundle_id),
    /** RGPD (#4): salts the pseudonym so distinct learners on the same lesson get distinct
     * pseudonyms. Defaults to "anonymous" so callers/tests that omit it still compile and stay
     * deterministic. */
    private readonly learnerId: string = "anonymous",
    /** The learner profile can prove completion even when no per-bundle state is available. */
    private readonly completedInProfile = false,
  ) {
    this.locale = localeFromLanguage(bundle.metadata.language);
    this.restoreSelfRatingRequests(state);
  }

  /** L-9: a state written since requests are persisted carries `self_rating_requests` (`{}` when none
   * is pending) and is authoritative. A state without the field was saved by a server that kept them in
   * memory: a scene whose last answer there was uncertified had a request that expired with it. */
  private restoreSelfRatingRequests(state: LearnerState): void {
    if (state.self_rating_requests) {
      for (const [sceneId, request] of Object.entries(state.self_rating_requests)) {
        this.pendingSelfRatings.set(sceneId, { conceptIds: [...request.concept_ids], requestedAt: request.requested_at });
      }
      return;
    }
    const lastAnswerCertified = new Map<string, boolean>();
    for (const entry of state.history) {
      if (entry.signal.kind === "answer_submitted") lastAnswerCertified.set(entry.scene_id, entry.signal.correct !== undefined);
    }
    for (const [sceneId, certified] of lastAnswerCertified) if (!certified) this.expiredSelfRatings.add(sceneId);
  }

  async start(): Promise<Presentation> {
    this.sessionId = this.deps.idGen.uuid();
    this.pseudonym = await this.deps.pseudonym.get(this.learnerId, this.bundle.bundle_id);
    this.ctx = { learnerPseudonym: this.pseudonym, lessonId: this.bundle.bundle_id, bundleVersion: bundleVersionOf(this.bundle) };
    this.engine = new AdaptationEngine(this.bundle.rules, this.state, () => this.deps.clock.now());
    this.state = this.engine.getState();
    this.idx = this.startingSceneIndex();
    if (this.idx > 0) ({ trail: this.trail, facts: this.facts } = trailFromHistory(this.state.history));
    this.restoreDetour();
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
    this.markSceneEntered();
    return this.currentPresentation();
  }

  private startingSceneIndex(): number {
    const completed = new Set(this.state.scenes_completed);
    if (this.lessonDone()) return 0;
    const firstIncomplete = this.bundle.scenes.findIndex((scene) => !completed.has(scene.id));
    return firstIncomplete < 0 ? 0 : firstIncomplete;
  }

  /** The lesson was completed before this session: it is played again from the start. */
  private lessonDone(): boolean {
    const completed = new Set(this.state.scenes_completed);
    return this.completedInProfile || this.bundle.scenes.every((scene) => completed.has(scene.id));
  }

  /** Audit 2026-11-10 D6: a detour under way when the state was saved is taken up again — the
   * remediation is served, and the lesson returns where it would have. A detour naming a scene this
   * lesson no longer has is ignored (the lesson resumes on its first scene not completed). */
  private restoreDetour(): void {
    const detour = this.state.pending_detour;
    if (!detour || this.lessonDone()) return;
    const at = this.bundle.scenes.findIndex((scene) => scene.id === detour.scene_id);
    const back = detour.returns_to === null ? this.bundle.scenes.length
      : this.bundle.scenes.findIndex((scene) => scene.id === detour.returns_to);
    if (at < 0 || back < 0) return;
    if (this.idx === 0 && this.state.history.length) ({ trail: this.trail, facts: this.facts } = trailFromHistory(this.state.history));
    this.idx = at;
    this.pendingDetourReturnIdx = back;
    if (detour.prerequisite !== undefined) this.graphDetourPrerequisite = detour.prerequisite;
    this.showHintsAvailable = true;
  }

  /** The detour under way, as the state saves it (D6): the remediation on screen (or the one a check
   * question interrupted), where the lesson returns, the prerequisite it waits on. */
  private detourNow(): PendingDetourState | undefined {
    if (!this.started || this.completed || this.pendingDetourReturnIdx === undefined) return undefined;
    const serving = this.bundle.scenes[this.check ? this.check.returnIdx : this.idx];
    if (!serving) return undefined;
    return {
      scene_id: serving.id,
      returns_to: this.bundle.scenes[this.pendingDetourReturnIdx]?.id ?? null,
      ...(this.graphDetourPrerequisite === undefined ? {} : { prerequisite: this.graphDetourPrerequisite }),
    };
  }

  currentPresentation(): Presentation {
    this.assertStarted();
    const presentation: Presentation = {
      locale: this.locale,
      scene: this.scene(),
      index: this.idx,
      total: this.bundle.scenes.length,
      lastDecision: this.state.last_decision,
      explanation: this.explainLast(),
      learnerSnapshot: this.snapshot(),
    };
    if (this.showHintsAvailable) presentation.hints_available = this.hintsAvailable();
    return presentation;
  }

  /** Hint requests the learner can still make on this visit of the current scene (the budget
   * `requestHint` spends): 0 on a scene with no hint and once the visit's hints are used. */
  hintsLeft(): number {
    this.assertStarted();
    return this.hintsAvailable();
  }

  private hintsAvailable(): number {
    const scene = this.scene();
    if (scene.type !== "quiz") return 0;
    const cap = this.scaffolding === "heavy" ? scene.hints.length : Math.min(1, scene.hints.length);
    return Math.max(0, cap - this.hintsUsed);
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
    st.self_rating_requests = Object.fromEntries([...this.pendingSelfRatings].map(([sceneId, request]) =>
      [sceneId, { concept_ids: [...request.conceptIds], requested_at: request.requestedAt }]));
    const detour = this.detourNow();
    if (detour) st.pending_detour = detour;
    else delete st.pending_detour;
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
    // RUN ALREADY RECORDED: a learner-time run scene revisited after a graph detour (2026-10-29 trial:
    // the file channel asked for a full re-provision, the operator that remembered the run wedged).
    // Say so on the scene itself, so MCP, file channel and extension all know an `ack` suffices.
    if (s.type === "reproduction" && (s as { run_manifest?: unknown }).run_manifest && s.task_card_id) {
      const run = this.learnerRuns.get(s.task_card_id);
      if (run) return { ...s, learner_run_recorded: true, learner_run_landmark: run.landmark } as Scene;
    }
    return s;
  }

  /** The learner's recorded run for a task card, or null — read by the host to tell a harness that
   * a revisited run scene needs no re-run. */
  learnerRunFor(taskCardId: string): ReferenceRun | null { return this.learnerRuns.get(taskCardId) ?? null; }
  protected assertStarted(): void { if (!this.started) throw new SessionNotStartedError(); }
  protected emit(partial: EmitInput): TelemetryEvent {
    const event = enrichEvent(partial, this.ctx, this.deps.clock, this.deps.idGen);
    this.deps.telemetry.emit(event);
    return event;
  }
  /** Announce the current scene and remember when it was entered (RT-8 time on scene). */
  private markSceneEntered(): void {
    const event = this.emit({ type: "scene_entered", scene_id: this.scene().id, scene_type: this.scene().type });
    this.sceneEnteredAtMs = Date.parse(event.client_timestamp);
  }
  private snapshot(): LearnerSnapshot {
    const conceptMastery: Record<string, number> = {};
    for (const [id, cs] of Object.entries(this.state.concept_states)) conceptMastery[id] = masteryOf(cs);
    return { conceptMastery, scenesCompleted: this.state.scenes_completed.length };
  }

  /** The session facts behind a learner-facing map: each step served with its outcome, and the
   * prerequisites the session credited (bare concept ids). Posterior mastery alone cannot tell
   * where the learner is: it stays under theta long after a gate was passed. */
  learnerPath(): LearnerPath {
    return {
      steps: this.trail.map((step) => ({ ...step, ...(step.navigation ? { navigation: { ...step.navigation } } : {}) })),
      passed_prerequisites: [...this.passedPrerequisites].map((id) => id.replace(/^concept:/, "")),
    };
  }

  /** When each answered step of the path was answered, with how many hints, and whether the learner
   * then rated their own recall: the evidence a concept map shows beside each state. */
  answerFacts(): AnswerFact[] { return this.facts.map((fact) => ({ ...fact })); }

  /** Every graded attempt on the concept (LWG `concept:` id) was correct, and there was at least one. */
  private hasFlawlessRecord(lwgConceptId: string): boolean {
    const cs = this.state.concept_states[lwgConceptId.replace(/^concept:/, "")];
    return cs !== undefined && cs.total_attempts > 0 && cs.total_correct === cs.total_attempts;
  }

  private rememberExplanation(explanation: Explanation): void {
    this.activeNavigationExplanation = explanation;
    this.lastGraphExplanation = explanation;
  }

  private rememberDecision(decision: Decision): void {
    if (!decision.rule_id || !decision.modulator) return;
    this.lastGraphExplanation = {
      rule_id: decision.rule_id,
      explanation_short: decision.explanation_short ?? "",
      modulator: decision.modulator,
    };
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
    this.rememberExplanation({
      rule_id: "graph_universe_escalated",
      explanation_short: phrase("explanation_graph_universe_escalated", {}, this.locale),
      modulator: "M6",
    });
    this.emit({ type: "universe_selected", universe_id: remedial.id, active_decisions: remedial.decisions });
    this.emit({ type: "adaptation_applied", rule_id: "graph_universe_escalated", signal: "navigate", modulator: "M6", value: 0 });
  }

  async respond(input: ResponseInput): Promise<Transition> {
    this.assertStarted();
    if (this.completed) throw new SessionAlreadyCompleteError();
    const scene = this.scene();
    // RT-8: time on scene, from the scene's entry to this answer on the session clock. Graders put it
    // on the signal (the engine publishes it to rules as `time_on_scene`) and on the telemetry.
    const answeredAt = this.deps.clock.now();
    const answeredAtMs = Date.parse(answeredAt);
    const timeMs = elapsedMs(this.sceneEnteredAtMs, answeredAtMs);
    // M1: look up the scene concept's Bloom target from the bundle so grade() can derive
    // the IRT difficulty `w` from it (mirrors how hintCount is threaded). Absent -> grader fallback.
    const conceptId = "concept_refs" in scene ? scene.concept_refs[0] : undefined;
    const bloomLevel = conceptId ? this.bundle.concepts.find((c) => c.id === conceptId)?.bloom_level_target : undefined;
    const { signal, telemetry, detail, coverage } = await grade(scene, input, {
      critiqueEvaluator: this.deps.critiqueEvaluator, hintCount: this.hintsUsed, timeMs,
      ...(this.deps.auditJudge ? { auditJudge: this.deps.auditJudge } : {}),
      ...(bloomLevel ? { bloomLevel } : {}),
    });
    for (const ev of telemetry) this.emit(ev);
    const decision = await this.applySignal(signal);                 // drives navigation
    this.rememberDecision(decision);
    if (signal.kind !== "scene_completed") {
      await this.applySignal({ kind: "scene_completed", scene_id: scene.id, duration_ms: timeMs }); // bookkeeping only
    }
    const success = this.successOf(signal);
    this.emit({ type: "scene_completed", scene_id: scene.id, duration_ms: timeMs, ...(success === undefined ? {} : { success }) });
    this.lastSuccess = signal.kind === "answer_submitted" ? signal.correct : undefined;
    this.trail.push({
      step: this.trail.length + 1, scene_id: scene.id, answered: signal.kind === "answer_submitted",
      correct: signal.kind === "answer_submitted" && typeof signal.correct === "boolean" ? signal.correct : null,
    });
    if (signal.kind === "answer_submitted") {
      this.facts.push({ step: this.trail.length, scene_id: scene.id, at: answeredAt, hints: signal.hint_count, self_rated: false });
    }
    // A check question answered right is still asked when the lesson reaches it: a check skips nothing.
    if (!this.check) {
      if (this.lastSuccess === true) this.answeredRight.add(scene.id);
      else if (this.lastSuccess === false) this.answeredRight.delete(scene.id);
    }
    const verdict = this.verdictOf(scene, signal, detail, coverage);
    const selfRating = await this.selfRatingFor(scene, signal, answeredAtMs);
    const t = this.check ? this.afterCheck(decision) : this.navigate(decision, scene, answeredAtMs);
    this.lastSuccess = undefined;
    // D6: the state was saved before routing; a detour that began or ended here is saved with it.
    if (JSON.stringify(this.detourNow() ?? null) !== JSON.stringify(this.state.pending_detour ?? null)) await this.saveState();
    const served = this.trail.at(-1);
    if (served) {
      if (served.answered) served.assessed_by = verdict.assessed_by;
      if (t.navigation) {
        served.navigation = {
          kind: t.navigation.kind, rule_id: t.navigation.rule_id,
          ...(t.navigation.returns_to === undefined ? {} : { returns_to: t.navigation.returns_to }),
        };
      }
    }
    return { ...t, verdict, ...(selfRating ? { self_rating: selfRating } : {}) };
  }

  /** C4: a production answer no judge certified (graded, `correct` absent) asks the learner to rate
   * their own recall; any other answer clears a pending request for that scene. */
  private async selfRatingFor(scene: Scene, signal: Signal, answeredAtMs: number): Promise<SelfRatingRequest | undefined> {
    // A new answer settles whatever an older process left on this scene.
    this.expiredSelfRatings.delete(scene.id);
    if (signal.kind === "answer_submitted" && signal.correct === undefined) {
      const refs = "concept_refs" in scene ? scene.concept_refs.filter((id) => id !== "") : [];
      const conceptIds = refs.length > 0 ? [...new Set(refs)] : [signal.concept_id];
      const requestedAt = Number.isFinite(answeredAtMs) ? new Date(answeredAtMs).toISOString() : "";
      this.pendingSelfRatings.set(scene.id, { conceptIds, requestedAt });
      await this.saveState();
      return selfRatingRequest();
    }
    if (this.pendingSelfRatings.delete(scene.id)) await this.saveState();
    return undefined;
  }

  /** Save the state as the session holds it now (L-9: after a self-rating request changed). */
  private async saveState(): Promise<void> {
    this.state = this.engineStateWithReplays();
    await this.deps.stateStore.save(this.bundle.bundle_id, this.state);
  }

  /** C4: the learner's own recall rating for a scene whose last answer asked for one. Validated,
   * recorded in the event log (`recall_self_rated`) and returned for the host to fold into the FSRS
   * memory. It NEVER moves mastery: no engine signal, no concept state, no history entry. Allowed
   * after completion, since the last scene may be the one rated; one rating per request. */
  async rateRecall(sceneId: string, grade: SelfRating): Promise<SelfRatingRecord> {
    this.assertStarted();
    if (!isSelfRating(grade)) throw new InvalidSelfRatingError(String(grade));
    const pending = this.pendingSelfRatings.get(sceneId);
    if (!pending) {
      if (this.expiredSelfRatings.has(sceneId)) throw new SelfRatingExpiredError(sceneId);
      throw new SelfRatingNotRequestedError(sceneId);
    }
    this.pendingSelfRatings.delete(sceneId);
    await this.saveState();
    const rated = this.facts.filter((fact) => fact.scene_id === sceneId).at(-1);   // the latest answer to that scene
    if (rated) rated.self_rated = true;
    const record: SelfRatingRecord = {
      scene_id: sceneId, concept_id: pending.conceptIds[0]!, concept_ids: [...pending.conceptIds], grade, fsrs_grade: fsrsGradeOf(grade),
      source: "self_rated", rated_at: this.deps.clock.now(),
    };
    await this.deps.eventLog.append({
      event_id: this.deps.idGen.uuid(), session_id: this.sessionId, pseudonyme: this.pseudonym,
      lesson_id: this.bundle.bundle_id, schema_version: "1.0", timestamp: record.rated_at,
      event_type: "recall_self_rated", payload: record,
    });
    return record;
  }

  /** The verdict carried on the transition (types.ts Verdict). Only the matching half of the quiz
   * feedback is released, and only here — after the answer; the public scene no longer carries it.
   * A graded key-point, audit or critique scene also releases its reference as data (I-1, T3). */
  private verdictOf(scene: Scene, signal: Signal, detail?: GradeDetail, coverage?: JudgedCoverage): Verdict {
    const graded = signal.kind === "answer_submitted";
    const correct = graded ? signal.correct : undefined;
    let feedback: string | undefined;
    if (scene.type === "quiz" && correct !== undefined) feedback = correct ? scene.feedback_correct : scene.feedback_incorrect;
    if (graded && scene.type !== "quiz") feedback = feedbackFor(scene, this.locale, detail, coverage);
    const reference = graded ? referenceOf(scene, coverage, correct) : undefined;
    return {
      scene_id: scene.id,
      graded,
      signal: signal.kind,
      assessed_by: assessedBy(scene, graded, correct, detail, coverage),
      ...(correct === undefined ? {} : { correct }),
      ...(feedback ? { feedback } : {}),
      ...(detail ? { detail } : {}),
      ...(reference ?? {}),
    };
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

  /** Success of the answer that was just graded (undefined on ack-only scenes). Read by navigate():
   * a graph detour that would re-serve the scene the learner JUST got right is pointless (mastery
   * rises too slowly for one correct answer to clear theta), so the gate is passed instead. */
  private lastSuccess: boolean | undefined = undefined;
  /** What the learner did, in the order it was served: the facts a learner-facing map is drawn from
   * (learnerPath). Rebuilt from the saved history when a lesson is resumed part-way. */
  private trail: PathStep[] = [];
  /** One fact per answered step of the trail (answerFacts). */
  private facts: AnswerFact[] = [];
  /** Check questions being asked (insertChecks): the scenes still to serve, and where the lesson resumes. */
  private check: { queue: number[]; returnIdx: number } | null = null;
  /** Answer-graded scenes whose latest answer in this session was correct. Session-local, like
   * `passedPrerequisites`: a lesson played again from the start asks its questions again. */
  private answeredRight = new Set<string>();

  /** The one navigation record behind a transition (see Navigation in types.ts). `rule_id` /
   * `modulator` come from the graph explanation when the graph routed, else from the rule engine. */
  private nav(decision: Decision, kind: Navigation["kind"], reason: string | null, extra: Partial<Navigation> = {}): Navigation {
    const src = this.activeNavigationExplanation;
    return {
      kind,
      scene_id: this.started && !this.completed ? this.scene().id : null,
      rule_id: src?.rule_id ?? decision.rule_id,
      reason,
      modulator: src?.modulator ?? decision.modulator,
      ...extra,
    };
  }

  /** `nowMs` is the answer time; skip-on-mastery weighs mastery by retention at that moment (RT-2). */
  protected navigate(decision: Decision, scene: Scene, nowMs: number = Number.NaN): Transition {
    this.activeNavigationExplanation = null;
    const action = decision.next_action;
    if (action.kind === "replay_current_scene") {
      // Despite its stable schema name, this action prefers an unseen same-concept item. It replays
      // the current scene only when no alternate exists; both paths restore a fresh hint budget.
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
        // Resume right after the alternate only when it is the very next scene. An alternate
        // further down (a closing recall item) is a detour: the lesson resumes after the scene
        // just left, or everything between the two would never be served.
        const resumeIdx = altIdx === this.idx + 1 ? altIdx + 1 : this.idx + 1;
        this.pendingDetourReturnIdx = resumeIdx;
        this.scaffoldingEvents += 1; // remediation is still a scaffold the learner relied on
        this.idx = altIdx;
        this.enterScene();
        this.showHintsAvailable = true;
        const resume = this.bundle.scenes[resumeIdx] as Scene | undefined;
        return { kind: "remediate_alt", reason: action.reason, presentation: this.currentPresentation(),
          navigation: this.nav(decision, "remediate_alt", action.reason, resume ? { returns_to: resume.id } : {}) };
      }
      // no unseen alternate -> honest fallback: replay the same item, while the budget lasts.
      // Counted ONCE, in the session-owned tally; applySignal projects it onto
      // `state.scenes_replayed` before each save, and `scaffoldingEvents` feeds autonomyRatio.
      if ((this.replayCounts[scene.id] ?? 0) < MAX_SCENE_REPLAYS) {
        this.replayCounts[scene.id] = (this.replayCounts[scene.id] ?? 0) + 1;
        this.scaffoldingEvents += 1;
        this.showHintsAvailable = true;
        // RT-8: the second attempt is timed from the moment the replay is shown, i.e. this answer.
        // No scene_entered is emitted here (the scene never changed), so the clock restarts silently.
        this.sceneEnteredAtMs = nowMs;
        return { kind: "replay", reason: action.reason, presentation: this.currentPresentation(),
          navigation: this.nav(decision, "replay", action.reason) };
      }
      // Budget spent: stop re-serving the same scene and FALL THROUGH to the normal advance below.
      // Announced, not silent — the learner leaves this scene without getting it right, and that is
      // exactly what the teacher needs to see.
      this.rememberExplanation({
        rule_id: "replay_budget_exhausted",
        explanation_short: phrase("explanation_replay_budget_exhausted", {}, this.locale),
        modulator: "M1",
      });
      this.emit({ type: "adaptation_applied", rule_id: "replay_budget_exhausted", signal: "navigate", modulator: "M1", value: 0 });
    }
    if (action.kind === "skip_to_next_concept") {
      // NOTE: engine-fired explicit actions (skip/calibration) take priority over LWG prereq gating.
      const currentConcept = "concept_refs" in scene ? (scene.concept_refs[0] ?? "") : "";
      const next = this.bundle.scenes.findIndex((s, i) =>
        i > this.idx && ("concept_refs" in s ? (s.concept_refs[0] ?? "") : "") !== currentConcept);
      if (next >= 0) {
        this.idx = next; this.enterScene();
        this.pendingDetourReturnIdx = undefined;
        return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "skip_concept", decision.explanation_short) };
      }
      // no later scene with a different concept — fall through to advance/complete
    }
    if (action.kind === "show_calibration_panel") {
      // NOTE: engine-fired explicit actions (skip/calibration) take priority over LWG prereq gating.
      const target = action.target_concept;
      // End-of-lesson self-check: no next scene to host a standalone calibration
      // transition, so surface the M3 feedback on the completion instead of dropping it.
      if (this.idx + 1 >= this.bundle.scenes.length) return this.complete(decision, { targetConcept: target });
      this.idx += 1; this.enterScene();
      return { kind: "calibration", targetConcept: target, presentation: this.currentPresentation(),
        navigation: this.nav(decision, "calibration", decision.explanation_short) };
    }
    // advance_to_next_scene | show_explanation_panel | fallback
    const lwg = this.bundle.learning_workflow_graph;
    if (lwg) {
      const routeStartIdx = this.pendingDetourReturnIdx === undefined
        ? this.idx
        : this.pendingDetourReturnIdx - 1;
      const route = (): GraphNavResult => graphAwareNextIndex(
        this.bundle.scenes, routeStartIdx, lwg,
        buildLwgMastery(this.state.concept_states), this.theta, this.skipMastered,
        buildLwgCalibration(this.state.concept_states),
        this.prereqDetours,
        new Set(this.state.scenes_completed),
        this.passedPrerequisites,
        buildLwgEffectiveMastery(this.state.concept_states, this.state.concept_memory, nowMs),
        this.answeredRight,
      );
      // PREREQUISITE PASSED. Two cases credit a prerequisite still below theta instead of drilling
      // it: (a) the learner just answered one of its items correctly while on a graph detour for
      // it; (b) its record is flawless — every graded attempt correct — so the low posterior is
      // only the prior's inertia (one correct answer moves 0.5 -> 0.54; the 2026-10-29 trials
      // re-served the same item up to the detour limit). A prerequisite with recorded errors and
      // no correct detour answer stays gated: that posterior is evidence, and the detour budget
      // plus escalation are the designed answer. A pass is remembered for the session (W1), so
      // later scenes gated on the same prerequisite do not re-open it.
      //
      // The credit is given BEFORE routing, and the route is taken again after each one, so that
      // a scene with several unmet prerequisites is judged on each of them. Crediting only when
      // the router chose the same prerequisite again (the previous rule) had two faults, found by
      // simulation on atomistique-l1 on 6 Nov 2026: when the router chose the other prerequisite
      // the correct answer was lost and the learner went back and forth between the two until the
      // budget released the gate; when it chose the same one the gate opened on the scene with the
      // other prerequisite never checked.
      let openedGate: number | undefined;
      const detourPrerequisite = this.graphDetourPrerequisite;
      if (detourPrerequisite !== undefined && sceneConceptId(scene) === detourPrerequisite && this.lastSuccess === true) {
        this.passedPrerequisites.add(detourPrerequisite);
        openedGate = this.pendingDetourReturnIdx;
      }
      let routed = route();
      while (routed.reason === "remediate" && routed.index !== null && routed.gated != null) {
        const flawless = sceneConceptId(this.bundle.scenes[routed.index] as { concept_refs?: string[] });
        if (flawless === null || !this.hasFlawlessRecord(flawless)) break;
        this.passedPrerequisites.add(flawless);
        openedGate = routed.gated;
        routed = route();
      }
      const nextIdx = routed.index;
      let reason: GraphNavResult["reason"] | "gate_passed" = routed.reason;
      if (nextIdx === null) {
        this.pendingDetourReturnIdx = undefined;
        return this.complete(decision);
      }
      const gatedId = routed.gated != null ? (this.bundle.scenes[routed.gated] as Scene).id : undefined;
      if (reason === "gate_unassessable" && routed.prerequisite
        && this.announcedUnassessablePrerequisites.has(routed.prerequisite)) {
        reason = "advance";
      }
      if (reason === "advance" && openedGate !== undefined && nextIdx === openedGate) reason = "gate_passed";
      const routedConcept = sceneConceptId(this.bundle.scenes[nextIdx] as { concept_refs?: string[] });
      this.graphDetourPrerequisite = reason === "remediate" && routedConcept !== null ? routedConcept : undefined;
      if (reason === "remediate" && routed.gated !== undefined) {
        this.pendingDetourReturnIdx = routed.gated;
      } else {
        this.pendingDetourReturnIdx = undefined;
      }
      const skippedSceneIds = reason === "skip_mastered"
        ? this.bundle.scenes.slice(routeStartIdx + 1, nextIdx).map((skipped) => skipped.id)
          .filter((id) => !this.answeredRight.has(id))
        : [];
      this.idx = nextIdx;
      this.enterScene();
      if (reason === "remediate") {
        this.showHintsAvailable = true;
        const explanation = { rule_id: "graph_prereq_gate", explanation_short: phrase("explanation_graph_prereq_gate", {}, this.locale), modulator: "M6" };
        this.rememberExplanation(explanation);
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate", signal: "navigate", modulator: "M6", value: 0 });
        this.remediationCount += 1;
        this.scaffoldingEvents += 1; // a prerequisite remediation detour is scaffolding the learner relied on
        // Spend one unit of THIS prerequisite's detour budget. Keyed on the concept we were routed
        // TO (the unmet prereq), which is the concept the gate is waiting on — not the gated one.
        const detoured = sceneConceptId(this.bundle.scenes[nextIdx] as { concept_refs?: string[] });
        if (detoured) {
          this.prereqDetours[detoured] = (this.prereqDetours[detoured] ?? 0) + 1;
          const detouredScene = (this.bundle.scenes[nextIdx] as Scene).id;
          this.detourCounts[detouredScene] = (this.detourCounts[detouredScene] ?? 0) + 1;
        }
        this.maybeEscalateUniverse();
        const reasonText = explanation.explanation_short;
        return { kind: "remediate", reason: reasonText, presentation: this.currentPresentation(),
          navigation: this.nav(decision, "remediate", reasonText, gatedId ? { returns_to: gatedId } : {}) };
      } else if (reason === "gate_passed") {
        const explanation = { rule_id: "graph_prereq_gate_passed", explanation_short: phrase("explanation_graph_prereq_gate_passed", {}, this.locale), modulator: "M6" };
        this.rememberExplanation(explanation);
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate_passed", signal: "navigate", modulator: "M6", value: 0 });
        return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "gate_passed", explanation.explanation_short) };
      } else if (reason === "gate_released") {
        // The budget is spent and the learner is let into the gated scene WITHOUT the prerequisite.
        // Announced rather than silent: an unmastered pass is a thing the teacher must be able to
        // see, and it is the only alternative to a lesson that never ends.
        const explanation = { rule_id: "graph_prereq_gate_released", explanation_short: phrase("explanation_graph_prereq_gate_released", {}, this.locale), modulator: "M6" };
        this.rememberExplanation(explanation);
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_gate_released", signal: "navigate", modulator: "M6", value: 0 });
        return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "gate_released", explanation.explanation_short) };
      } else if (reason === "gate_unassessable") {
        // INT-STUDIUM-037. The prerequisite is unmet and the lesson holds no scene the router can
        // send the learner back to, so the gate opens on the first try. Before this it was reported
        // as a plain advance — indistinguishable from an ordinary next step — and on the real
        // atomistique-l1 bundle it happens FOUR times to a learner who has mastered nothing, while
        // graph_prereq_gate_released fires zero times. Its own rule_id, not the release's: the
        // release says the learner did not manage it after three tries, this says the bundle gave
        // them nothing to try. The second is an authoring defect and the teacher is the one who can
        // fix it.
        const explanation = { rule_id: "graph_prereq_unassessable", explanation_short: phrase("explanation_graph_prereq_unassessable", {}, this.locale), modulator: "M6" };
        this.rememberExplanation(explanation);
        if (routed.prerequisite) this.announcedUnassessablePrerequisites.add(routed.prerequisite);
        this.emit({ type: "adaptation_applied", rule_id: "graph_prereq_unassessable", signal: "navigate", modulator: "M6", value: 0 });
        return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "gate_unassessable", explanation.explanation_short) };
      } else if (reason === "skip_mastered") {
        const explanation = { rule_id: "graph_skip_mastered", explanation_short: phrase("explanation_graph_skip_mastered", {}, this.locale), modulator: "M1" };
        this.rememberExplanation(explanation);
        this.emit({ type: "adaptation_applied", rule_id: "graph_skip_mastered", signal: "navigate", modulator: "M1", value: 0 });
        return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "skip_mastered", explanation.explanation_short, { skipped_scene_ids: skippedSceneIds }) };
      }
      return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "advance", null) };
    }
    let nextIdx = this.pendingDetourReturnIdx ?? this.idx + 1;
    this.pendingDetourReturnIdx = undefined;
    // An item already answered correctly as an alternate is not asked again when the lesson reaches it.
    while (nextIdx < this.bundle.scenes.length
      && ANSWER_GRADED_TYPES.has(this.bundle.scenes[nextIdx]!.type) && this.answeredRight.has(this.bundle.scenes[nextIdx]!.id)) nextIdx += 1;
    if (nextIdx >= this.bundle.scenes.length) return this.complete(decision);
    this.idx = nextIdx; this.enterScene();
    return { kind: "next", presentation: this.currentPresentation(), navigation: this.nav(decision, "advance", null) };
  }

  /** Insert check questions (a contested concept): serve these scenes of the lesson one after the
   * other, each graded as any answer, then resume on the scene the learner was on. The routing of the
   * lesson (replays, detours, prerequisite gates, skips) does not run on a check answer, so a check
   * skips nothing and credits no prerequisite; mastery moves by the usual grading only. Kept in
   * memory: a session resumed after a restart has no check pending. */
  insertChecks(sceneIds: readonly string[]): Presentation {
    this.assertStarted();
    if (this.completed) throw new SessionAlreadyCompleteError();
    if (this.check) throw new SessionError("check questions are already being asked");
    if (sceneIds.length === 0) throw new SessionError("a check asks at least one question");
    const queue = sceneIds.map((id) => {
      const at = this.bundle.scenes.findIndex((scene) => scene.id === id);
      if (at < 0) throw new SessionError(`no scene "${id}" in this lesson`);
      return at;
    });
    this.check = { queue: queue.slice(1), returnIdx: this.idx };
    this.idx = queue[0]!;
    this.enterScene();
    return this.currentPresentation();
  }

  /** Check questions are being asked: the next answers are theirs. */
  checkPending(): boolean { return this.check !== null; }

  /** While check questions are asked: the indexes of those still to come after the one on screen, and
   * the index of the scene the lesson resumes on — what is left of the lesson is counted from there
   * (audit 2026-11-10 D8). null when no check is under way. */
  checkRoute(): { queued: number[]; returnIndex: number } | null {
    return this.check ? { queued: [...this.check.queue], returnIndex: this.check.returnIdx } : null;
  }

  /** After a check answer: the next check question, or back to the scene the learner was on. */
  private afterCheck(decision: Decision): Transition {
    const check = this.check!;
    const next = check.queue.shift();
    this.activeNavigationExplanation = null;
    if (next === undefined) { this.idx = check.returnIdx; this.check = null; } else this.idx = next;
    this.enterScene();
    return {
      kind: "next", presentation: this.currentPresentation(),
      navigation: { ...this.nav(decision, "advance", null), rule_id: next === undefined ? "contest_check_done" : "contest_check", modulator: null },
    };
  }

  /** Record a contest and its outcome in the event log (`concept_contested`). It moves no mastery. */
  async recordContest(record: ContestRecord): Promise<void> {
    this.assertStarted();
    await this.deps.eventLog.append({
      event_id: this.deps.idGen.uuid(), session_id: this.sessionId, pseudonyme: this.pseudonym,
      lesson_id: this.bundle.bundle_id, schema_version: "1.0", timestamp: this.deps.clock.now(),
      event_type: "concept_contested", payload: record,
    });
  }

  protected enterScene(): void {
    this.discussionTurnIdx = 0;
    this.discussionHistory = [];
    this.hintsUsed = 0;
    this.showHintsAvailable = false;
    this.markSceneEntered();
  }

  protected complete(decision: Decision, calibration?: { targetConcept: string }): Transition {
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
    const finalState = this.engineStateWithReplays();
    const mastery: Record<string, number> = {};
    for (const [conceptId, conceptState] of Object.entries(finalState.concept_states)) {
      mastery[conceptId] = masteryOf(conceptState);
    }
    const summary: CompletionSummary = {
      totalDurationMs,
      autonomyRatio,
      scenesCompleted: completed,
      finalState,
      mastery,
      scenes_detoured: { ...this.detourCounts },
    };
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
    return { kind: "complete", summary, ...(calibration ? { calibration } : {}),
      navigation: this.nav(decision, "complete", null) };
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
    const result = await this.deps.reasoningScorer.score(text, scene.topic, this.locale);
    if (result === null) return;                        // graceful degradation
    this.lastReasoning = { signal: result.signal, confidence: result.confidence };
    this.emit({ type: "reasoning_signal", scene_id: scene.id, signal: result.signal, confidence: result.confidence, turn_index: turnIndex });

    // EV-3a: live Socratic tutor (optional dep = flag). Telemetry-only; submitTurn stays void.
    if (!this.deps.socraticTutor) return;
    this.discussionHistory.push({ role: "learner", text });
    const move = await this.deps.socraticTutor.respond({
      topic: scene.topic, seedClaim: scene.seed_claim, learnerTurn: text,
      signal: result.signal, confidence: result.confidence, history: this.discussionHistory, locale: this.locale,
    });
    if (move === null) return;
    const banned = collectBannedAnswers(this.bundle, scene);
    const lowConfViolation = result.confidence < 0.4 && move.move_kind !== "scaffold_hint";
    const revealed = move.revealed || revealsAnswer(move.text, banned) || lowConfViolation;
    const safe = revealed ? fadedFallback(this.locale)[result.signal] : move;
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

/** Non-negative whole ms between two epoch-ms readings; 0 when either is unreadable. */
function elapsedMs(fromMs: number, toMs: number): number {
  return Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, Math.round(toMs - fromMs)) : 0;
}

/* RT-1 — the free-text feedback (sprint 2026-10-30, spec D5 / R4). A count ("2/4 key points
 * covered", "1/2 planted flaws found") is shown only when something MEASURED it: an LLM judge that
 * named the ids it found covered (`coverage`), or the verdict deck, whose marks are scored against
 * the key by identity (`detail`). Offline, the only count available came from the substring matcher
 * the project withdrew from grading (INT-STUDIUM-035): on the 2026-10-30 probe it told a learner who
 * negated all four key points "4/4 covered", and one who paraphrased them correctly "0/4 — Missing:
 * <all four>". So offline the verdict reveals the reference to compare against and states no count;
 * the transition asks for a self-rating instead (C4). Everything here is released after the answer only.
 *
 * Lead decision I-1: the reference of a key-point or audit scene — its key points (an audit's planted
 * flaws) and its model answer — is data on the verdict (`key_points`, `model_answer`, referenceOf),
 * which every surface renders; the feedback text says only what the answer earned (a measured count)
 * and never repeats the reference. ai_critique has no model answer: its reference is the claims that
 * hid a flaw, each with the flaws its author expected (`reference_kind: "flawed_claims"`; integration
 * tail T3), data on the verdict like the others, so the host withholds it on a replay too. */

type AuditScene = Extract<Scene, { type: "spot_the_flaw" | "summary_audit" }>;
type KeyPointScene = Extract<Scene, {
  type: "explain_back" | "comparison" | "prompt_practice" | "communication_sim";
}>;

const isKeyPointScene = (scene: Scene): scene is KeyPointScene => scene.type === "explain_back"
  || scene.type === "comparison" || scene.type === "prompt_practice" || scene.type === "communication_sim";

const isAuditScene = (scene: Scene): scene is AuditScene => scene.type === "spot_the_flaw" || scene.type === "summary_audit";

/** L-7: who assessed an answer. A quiz choice and the verdict deck (`detail`) are scored against the
 * author's key by identity; an LLM evaluation certifies `correct`, and an LLM audit judge's coverage is
 * a judge's measurement even when the evaluator degraded and certified no pass (H7); anything else —
 * an unjudged production answer, an acknowledgement — nobody assessed. */
function assessedBy(
  scene: Scene, graded: boolean, correct: boolean | undefined, detail?: GradeDetail, coverage?: JudgedCoverage,
): Verdict["assessed_by"] {
  if (!graded) return "none";
  if (scene.type === "quiz" || detail) return "key";
  return correct !== undefined || coverage ? "judge" : "none";
}

/** I-1: the reference of a graded key-point, audit or critique scene, released with its verdict; with a
 * judge's coverage, a key-point reference also names the points it found missing. L-2: a quiz answered
 * wrong releases the text of its correct choice(s) (`correct_choice`); a right one releases nothing. */
function referenceOf(
  scene: Scene, coverage?: JudgedCoverage, correct?: boolean,
): Pick<Verdict, "key_points" | "key_points_missing" | "model_answer" | "reference_kind"> | undefined {
  if (scene.type === "quiz") {
    const right = scene.choices.filter((choice) => choice.correct).map((choice) => choice.text);
    return correct === false && right.length > 0 ? { key_points: right, reference_kind: "correct_choice" } : undefined;
  }
  if (isKeyPointScene(scene)) {
    return {
      key_points: scene.key_points.map((point) => point.text),
      ...(coverage ? { key_points_missing: missingKeyPoints(scene, coverage).map((point) => point.text) } : {}),
      model_answer: modelAnswerOf(scene), reference_kind: "key_points",
    };
  }
  if (isAuditScene(scene)) {
    return { key_points: scene.claims.map((claim) => claim.text), model_answer: scene.model_correction, reference_kind: "planted_flaws" };
  }
  if (scene.type === "ai_critique") return { key_points: flawedClaimLines(scene), reference_kind: "flawed_claims" };
  return undefined;
}

/** An ai_critique's reference: one line per claim that hid a flaw, with the flaws its author expected
 * (a sound claim is not one to find; all claims when none hid one). */
function flawedClaimLines(scene: Extract<Scene, { type: "ai_critique" }>): string[] {
  const flawed = scene.claims.filter((claim) => claim.flaws_expected.length > 0);
  return (flawed.length > 0 ? flawed : scene.claims)
    .map((claim) => claim.flaws_expected.length > 0 ? `${claim.text} (${claim.flaws_expected.join(", ")})` : claim.text);
}

/** What an audit earned: a measured count (the verdict deck, or a judge), else nothing — the planted
 * flaws and the model correction are on the verdict (referenceOf). */
function auditFeedback(locale: Locale, detail?: GradeDetail, coverage?: JudgedCoverage): string | undefined {
  if (detail) {
    return phrase("deck_detail", {
      caught: detail.caught, planted: detail.planted, false_positives: detail.false_positives, sound_total: detail.sound_total,
    }, locale);
  }
  if (coverage) {
    return coverage.sound_total
      ? phrase("deck_detail", {
        caught: coverage.covered_ids.length, planted: coverage.total,
        false_positives: coverage.false_positives ?? 0, sound_total: coverage.sound_total,
      }, locale)
      : phrase("planted_flaws_found", { found: coverage.covered_ids.length, total: coverage.total }, locale);
  }
  return undefined;
}

function modelAnswerOf(scene: KeyPointScene): string {
  return scene.type === "explain_back" ? scene.model_explanation
    : scene.type === "comparison" ? scene.model_answer
      : scene.type === "prompt_practice" ? scene.model_prompt : scene.model_response;
}

/** The key points a judge found not covered. Reference data (`key_points_missing`), not feedback
 * text: the host withholds it with the rest of the reference until the learner leaves the scene. */
function missingKeyPoints(scene: KeyPointScene, coverage: JudgedCoverage): KeyPointScene["key_points"] {
  const covered = new Set(coverage.covered_ids);
  return scene.key_points.filter((point) => !covered.has(point.id));
}

/** What a key-point answer earned: with a judge, the count it measured (which points were missing is
 * on the verdict, `key_points_missing`); offline, nothing — the key points and the model answer are on
 * the verdict (referenceOf). */
function keyPointFeedback(scene: KeyPointScene, locale: Locale, coverage?: JudgedCoverage): string | undefined {
  if (!coverage) return undefined;
  const missing = missingKeyPoints(scene, coverage);
  return phrase("key_points_covered", { covered: scene.key_points.length - missing.length, total: scene.key_points.length }, locale);
}

/** What a critique earned: with a judge, the count of claims it found addressed; offline, nothing — the
 * claims that hid a flaw are on the verdict (referenceOf, `flawed_claims`). */
function critiqueFeedback(scene: Extract<Scene, { type: "ai_critique" }>, locale: Locale, coverage?: JudgedCoverage): string | undefined {
  if (!coverage) return undefined;
  return phrase("claims_addressed", { covered: coverage.covered_ids.length, total: scene.claims.length }, locale);
}

function feedbackFor(scene: Scene, locale: Locale, detail?: GradeDetail, coverage?: JudgedCoverage): string | undefined {
  if (scene.type === "spot_the_flaw") return auditFeedback(locale, detail, coverage);
  if (scene.type === "summary_audit") return auditFeedback(locale, undefined, coverage);
  if (scene.type === "ai_critique") return critiqueFeedback(scene, locale, coverage);
  if (isKeyPointScene(scene)) return keyPointFeedback(scene, locale, coverage);
  return undefined;
}

function decisionValue(signal: Signal): number {
  if (signal.kind === "answer_submitted") return signal.difficulty;
  if (signal.kind === "confidence_declared") return signal.value;
  return 0;
}
