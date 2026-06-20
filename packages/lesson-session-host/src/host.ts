// packages/lesson-session-host/src/host.ts
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, isAbsolute, relative } from "node:path";
import {
  LessonSession, enrichEvent, bundleVersionOf,
  type Presentation, type ResponseInput, type Transition, type Explanation, type HintResult,
} from "@studium/lesson-session";
import { masteryOf, type LearnerState } from "@studium/learner-state";
import { sceneRenderAssets, type RenderAsset } from "@studium/lesson-bundle-schema";
import type { GraphView } from "@studium/typed-graph-lens";
import { lwgToGraphView } from "@studium/typed-graph-lens/adapters/studium";
import { SessionRegistry, type SessionEntry } from "./registry.js";
import { buildHostDeps, durableDataDir, durableScopeDir } from "./deps.js";
import { resolveBundle, assetBaseDir } from "./bundle-resolver.js";

// Text-based render-asset kinds whose payload can be served inline from a file path (so a webview /
// notebook gets the content directly — no client-side file access, CSP-safe). Images stay as paths
// (the driver converts those to data URIs). A .cube orbital and an .xyz molecule are plain text.
const TEXT_INLINE_KINDS = new Set<RenderAsset["kind"]>([
  "orbital", "mol_3d", "spectrum", "code", "data_csv", "protocol_md", "svg",
]);

/** If an asset references a text file by relative path (and carries no inline payload), read it from
 * the bundle dir and inline it as `payload`. Confined to baseDir, with the canonical (symlink-
 * resolved) path re-validated so a malicious bundle can't symlink-escape and leak host files. The
 * per-session `cache` (keyed by resolved path) avoids re-reading the same .cube on every turn.
 * Exported for unit testing. */
export function inlineFileAsset(a: RenderAsset, baseDir: string, cache: Map<string, string>): RenderAsset {
  if (a.payload || !a.path || !baseDir || !TEXT_INLINE_KINDS.has(a.kind)) return a;
  const abs = isAbsolute(a.path) ? a.path : join(baseDir, a.path);
  if (escapes(baseDir, abs)) return a;
  const cached = cache.get(abs);
  if (cached !== undefined) return { ...a, payload: cached };
  try {
    // resolve symlinks and re-check the canonical path still lives inside the bundle dir
    const realBase = realpathSync(baseDir);
    const realAbs = realpathSync(abs);
    if (escapes(realBase, realAbs)) return a;
    const payload = readFileSync(realAbs, "utf8");
    cache.set(abs, payload);
    return { ...a, payload };
  } catch { return a; }
}

function escapes(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel.startsWith("..") || isAbsolute(rel);
}

export class SessionHostNotFoundError extends Error {
  constructor(id: string) { super(`session not found: ${id}`); this.name = "SessionHostNotFoundError"; }
}

export interface SessionHostOptions { bundlesRoot: string; live: boolean; }

/** Multi-session host shared by the HTTP and MCP drivers. */
export class SessionHost {
  private readonly registry = new SessionRegistry();
  constructor(private readonly opts: SessionHostOptions) {}

  async create(bundleRef: string, learnerId = "anonymous"): Promise<{ sessionId: string; presentation: Presentation }> {
    // Quiz-choice order is shuffled per scene id (same for all learners → aligned item analytics).
    // Opt in to PER-LEARNER answer order (anti answer-sharing) with STUDIUM_PER_LEARNER_SHUFFLE:
    // the learnerId salts the permutation so each learner gets a distinct-but-reproducible order.
    const shuffleSalt = process.env["STUDIUM_PER_LEARNER_SHUFFLE"] ? learnerId : "";
    const bundle = await resolveBundle(this.opts.bundlesRoot, bundleRef, shuffleSalt);
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
    const baseDir = assetBaseDir(this.opts.bundlesRoot, bundleRef);
    this.registry.create(sessionId, { session, deps, bundle, baseDir, assetCache: new Map() });
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
    const e = this.require(id);
    return sceneRenderAssets(e.session.currentPresentation().scene).map((a) => inlineFileAsset(a, e.baseDir, e.assetCache));
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
  /** The bundle's Learning Workflow Graph as a normalized GraphView, with LIVE per-concept state
   * (mastered / current / available / locked) derived from the learner's running mastery. This is
   * the state channel the graph view repaints each turn. null when the bundle carries no LWG. */
  workflowGraph(id: string): GraphView | null {
    const e = this.require(id);
    const lwg = e.bundle.learning_workflow_graph;
    if (!lwg) return null;
    const state = e.session.getState();
    // concept_states are keyed by bare concept id (e.g. "c-particules"); LWG node ids are
    // "concept:<id>" — re-prefix so the adapter's status lookup matches the node ids.
    const statuses: Record<string, { mastery: number; attempts: number }> = {};
    for (const [cid, cs] of Object.entries(state.concept_states)) {
      statuses[`concept:${cid}`] = { mastery: masteryOf(cs), attempts: cs.total_attempts };
    }
    return lwgToGraphView(lwg, statuses, { title: e.bundle.metadata.title });
  }
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
