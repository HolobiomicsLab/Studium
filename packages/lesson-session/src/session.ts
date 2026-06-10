import type { LessonBundle, Scene } from "@studium/lesson-bundle-schema";
import { AdaptationEngine } from "@studium/adaptation-engine";
import { defaultLearnerState, masteryOf, type LearnerState } from "@studium/learner-state";
import type { Presentation, Explanation, LearnerSnapshot, SessionDeps } from "./types.js";
import { enrichEvent, bundleVersionOf, type TelemetryContext, type EmitInput } from "./telemetry.js";
import { SessionNotStartedError } from "./errors.js";

export class LessonSession {
  private engine!: AdaptationEngine;
  private idx = 0;
  private started = false;
  private completed = false;
  private startIso = "";
  private ctx!: TelemetryContext;
  private sessionId = "";
  private pseudonym = "";
  protected discussionTurnIdx = 0;

  constructor(
    private readonly bundle: LessonBundle,
    private readonly deps: SessionDeps,
    private state: LearnerState = defaultLearnerState(bundle.bundle_id),
  ) {}

  async start(): Promise<Presentation> {
    this.sessionId = this.deps.idGen.uuid();
    this.pseudonym = await this.deps.pseudonym.get(this.bundle.bundle_id);
    this.ctx = { learnerPseudonym: this.pseudonym, lessonId: this.bundle.bundle_id, bundleVersion: bundleVersionOf(this.bundle) };
    this.engine = new AdaptationEngine(this.bundle.rules, this.state);
    this.state = this.engine.getState();
    this.startIso = this.deps.clock.now();
    this.started = true;
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

  explainLast(): Explanation | null { return this.started ? this.engine.explain() : null; }
  getState(): LearnerState { return this.started ? this.engine.getState() : this.state; }

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
}
