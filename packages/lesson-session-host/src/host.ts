// packages/lesson-session-host/src/host.ts
import { randomUUID } from "node:crypto";
import {
  LessonSession, enrichEvent, bundleVersionOf,
  type Presentation, type ResponseInput, type Transition, type Explanation,
} from "@studium/lesson-session";
import type { LearnerState } from "@studium/learner-state";
import { SessionRegistry, type SessionEntry } from "./registry.js";
import { buildHostDeps } from "./deps.js";
import { resolveBundle } from "./bundle-resolver.js";

export class SessionHostNotFoundError extends Error {
  constructor(id: string) { super(`session not found: ${id}`); this.name = "SessionHostNotFoundError"; }
}

export interface SessionHostOptions { bundlesRoot: string; live: boolean; }

/** Multi-session host shared by the HTTP and MCP drivers. */
export class SessionHost {
  private readonly registry = new SessionRegistry();
  constructor(private readonly opts: SessionHostOptions) {}

  async create(bundleRef: string, _learnerId?: string): Promise<{ sessionId: string; presentation: Presentation }> {
    const bundle = await resolveBundle(this.opts.bundlesRoot, bundleRef);
    const deps = buildHostDeps(this.opts.live);
    const session = new LessonSession(bundle, deps);
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
  async respond(id: string, input: ResponseInput): Promise<Transition> {
    const e = this.require(id);
    const transition = await e.session.respond(input);
    // Persist local mastery claims when the lesson completes (no-op for the in-memory sink;
    // writes the .jsonld for FileMasteryClaimSink). NOT flushed on forget() — that is the
    // RGPD-delete path.
    if (transition.kind === "complete") await e.deps.masteryClaimSink?.flush();
    return transition;
  }
  async submitTurn(id: string, text: string): Promise<void> { await this.require(id).session.submitTurn(text); }
  explainLast(id: string): Explanation | null { return this.require(id).session.explainLast(); }
  getState(id: string): LearnerState { return this.require(id).session.getState(); }
  has(id: string): boolean { return this.registry.has(id); }

  async forget(id: string): Promise<void> {
    const e = this.require(id);
    const lessonId = e.session.getState().lesson_id;
    const pseudonym = await e.deps.pseudonym.get(lessonId);
    e.deps.telemetry.emit(
      enrichEvent({ type: "forget_requested" },
        { learnerPseudonym: pseudonym, lessonId, bundleVersion: bundleVersionOf(e.bundle) },
        e.deps.clock, e.deps.idGen),
    );
    await e.deps.telemetry.flush();
    this.registry.delete(id);
  }
}
