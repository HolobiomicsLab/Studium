// packages/lesson-session-host/src/host.ts
import { randomUUID } from "node:crypto";
import {
  LessonSession, enrichEvent, bundleVersionOf,
  type Presentation, type ResponseInput, type Transition, type Explanation, type HintResult,
} from "@studium/lesson-session";
import type { LearnerState } from "@studium/learner-state";
import { sceneRenderAssets, type RenderAsset } from "@studium/lesson-bundle-schema";
import { SessionRegistry, type SessionEntry } from "./registry.js";
import { buildHostDeps, durableDataDir, durableScopeDir } from "./deps.js";
import { resolveBundle } from "./bundle-resolver.js";

export class SessionHostNotFoundError extends Error {
  constructor(id: string) { super(`session not found: ${id}`); this.name = "SessionHostNotFoundError"; }
}

export interface SessionHostOptions { bundlesRoot: string; live: boolean; }

/** Multi-session host shared by the HTTP and MCP drivers. */
export class SessionHost {
  private readonly registry = new SessionRegistry();
  constructor(private readonly opts: SessionHostOptions) {}

  async create(bundleRef: string, learnerId = "anonymous"): Promise<{ sessionId: string; presentation: Presentation }> {
    const bundle = await resolveBundle(this.opts.bundlesRoot, bundleRef);
    // #3 DURABLE mode (gated by STUDIUM_DATA_DIR): scope the File* stores under a per-learner dir
    // keyed by the RGPD-safe pseudonym (never the raw learnerId). We derive the pseudonym with the
    // SAME provider+secret+bundle_id the session uses in start() (session.ts), guaranteeing the
    // host dir pseudonym === session pseudonym (no salt drift / split-brain).
    const dataDir = durableDataDir();
    let deps;
    let prior: LearnerState | null = null;
    if (dataDir) {
      // Build deps once to obtain the (fail-closed) pseudonym provider, derive the scope dir, then
      // rebuild the deps with File* stores rooted at that dir. resolvePseudoSecret runs in
      // buildHostDeps, so a misconfigured prod still throws BEFORE any dir is touched.
      const probe = buildHostDeps(this.opts.live);
      const pseudonym = await probe.pseudonym.get(learnerId, bundle.bundle_id);
      const scopeDir = durableScopeDir(dataDir, pseudonym, bundle.bundle_id);
      deps = buildHostDeps(this.opts.live, scopeDir);
      // #3 RESUME: load any prior LearnerState for this (pseudonym, bundle_id). FileStateStore.load
      // returns null on missing/parse-error, so a fresh learner falls back to defaultLearnerState.
      prior = await deps.stateStore.load(bundle.bundle_id);
    } else {
      deps = buildHostDeps(this.opts.live);
    }
    // #4: thread the learnerId so the pseudonym is salted per learner (distinct learners on the
    // same lesson resolve to distinct pseudonyms). Previously discarded as `_learnerId`.
    // #3: pass the loaded prior state so the engine resumes prior concept_states/mastery; in
    // in-memory mode `prior` is null ⇒ collapses to the existing defaultLearnerState path.
    const session = new LessonSession(bundle, deps, prior ?? undefined, learnerId);
    const presentation = await session.start();
    const sessionId = randomUUID();
    this.registry.create(sessionId, { session, deps, bundle });
    return { sessionId, presentation };
  }

  private require(id: string): SessionEntry {
    const e = this.registry.get(id);
    if (!e) throw new SessionHostNotFoundError(id);
    return e;
  }

  currentPresentation(id: string): Presentation { return this.require(id).session.currentPresentation(); }
  /** The normalized render manifest for the current scene — the artifacts a UI pairs with this
   * scene (figure, equation, interactive plot, executed reference run, …). Empty for a plain quiz. */
  sceneArtifacts(id: string): RenderAsset[] {
    return sceneRenderAssets(this.require(id).session.currentPresentation().scene);
  }
  async respond(id: string, input: ResponseInput): Promise<Transition> {
    const e = this.require(id);
    const transition = await e.session.respond(input);
    // Persist local mastery claims when the lesson completes (no-op for the in-memory sink;
    // writes the .jsonld for FileMasteryClaimSink). NOT flushed on forget() — that is the
    // RGPD-delete path.
    if (transition.kind === "complete") {
      await e.deps.masteryClaimSink?.flush();
      // Flush consented telemetry to its durable sink at end-of-lesson (no-op for the in-memory
      // sink). With a JsonlTelemetrySink (consent path, see deps.ts) this writes the pseudonymized
      // ADR-006 event stream a teacher's class_report can later aggregate. forget() flush+purges.
      await e.deps.telemetry.flush();
    }
    return transition;
  }
  /** Pull the next authored hint for the current quiz scene (scaffolding-gated, M5 discount).
   * Returns null when the scene is not a quiz, has no hints, or the per-visit cap is reached. */
  requestHint(id: string): HintResult | null { return this.require(id).session.requestHint(); }
  async submitTurn(id: string, text: string): Promise<void> { await this.require(id).session.submitTurn(text); }
  /** The Socratic tutor move generated on the last discussion turn (null outside a discussion
   * or when no tutor is wired). */
  lastTutorMove(id: string): { text: string; move_kind: string; revealed: boolean } | null {
    return this.require(id).session.getLastTutorMove();
  }
  /** The reasoning signal scored on the last discussion turn (null if none yet). */
  lastReasoning(id: string): { signal: string; confidence: number } | null {
    return this.require(id).session.getLastReasoning();
  }
  explainLast(id: string): Explanation | null { return this.require(id).session.explainLast(); }
  getState(id: string): LearnerState { return this.require(id).session.getState(); }
  has(id: string): boolean { return this.registry.has(id); }

  async forget(id: string): Promise<void> {
    const e = this.require(id);
    const lessonId = e.session.getState().lesson_id;
    // reuse the session's already-salted pseudonym (no re-derivation / no stored learnerId needed).
    const pseudonym = e.session.getPseudonym();
    e.deps.telemetry.emit(
      enrichEvent({ type: "forget_requested" },
        { learnerPseudonym: pseudonym, lessonId, bundleVersion: bundleVersionOf(e.bundle) },
        e.deps.clock, e.deps.idGen),
    );
    await e.deps.telemetry.flush();
    // #4 REAL erasure: purge the learner's state + mastery .jsonld + event log + telemetry. Then
    // drop the registry entry. forget() used to be a no-op (only the event + registry delete).
    await e.session.erase();
    this.registry.delete(id);
  }
}
