// packages/lesson-session-host/src/host.ts
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, isAbsolute, relative } from "node:path";
import {
  LessonSession, enrichEvent, bundleVersionOf,
  type Presentation, type ResponseInput, type Transition, type Explanation, type HintResult,
} from "@studium/lesson-session";
import { masteryOf, type ConceptState, type LearnerState } from "@studium/learner-state";
import { sceneRenderAssets, type RenderAsset, type ReferenceRun, type RunManifest } from "@studium/lesson-bundle-schema";
import { runResultToReferenceRun, type RunResult } from "./run-result.js";
import type { GraphView } from "@studium/typed-graph-lens";
import { lwgToGraphView } from "@studium/typed-graph-lens/adapters/studium";
import { SessionRegistry, type SessionEntry } from "./registry.js";
import { buildHostDeps, durableDataDir, durableScopeDir } from "./deps.js";
import { resolveBundle, assetBaseDir } from "./bundle-resolver.js";
import { discoverCommunityBundles } from "./community-bundles.js";
import {
  aggregateRatings, ROOM_K_FLOOR,
  type PeerRating, type RoomEntry, type RoomState,
} from "./room.js";

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

// ---------------------------------------------------------------------------------------------
// FSRS read-side mirror. The authoritative scheduler is packages/adaptation-engine/src/fsrs.ts;
// these are a verbatim copy of its *read* functions (forgetting curve + stability/difficulty update
// + due test). They are inlined rather than imported because @studium/lesson-session-host does not
// declare @studium/adaptation-engine as a dependency (and a parallel workflow owns the package.json
// here, so we must not add it). Keep in lockstep with fsrs.ts: same constants, same formulas.
// ---------------------------------------------------------------------------------------------
type ReviewGrade = 1 | 2 | 3 | 4; // again | hard | good | easy
interface ConceptMemoryState {
  concept_id: string;
  stability: number;
  difficulty: number;
  last_reviewed_at: number | null;
  reps: number;
  lapses: number;
}
const FSRS_DAY_MS = 86_400_000;
const FSRS_DECAY = -0.5;
const FSRS_FACTOR = 19 / 81;
type FsrsWeights = readonly [
  number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
];
const FSRS_W: FsrsWeights = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61,
];
const fsrsClampD = (d: number): number => Math.max(1, Math.min(10, d));
function fsrsDefaultMemory(concept_id: string): ConceptMemoryState {
  return { concept_id, stability: 0, difficulty: 0, last_reviewed_at: null, reps: 0, lapses: 0 };
}
function fsrsRetrievability(s: ConceptMemoryState, nowMs: number): number {
  if (s.reps === 0 || s.last_reviewed_at === null || s.stability <= 0) return 0;
  const tDays = Math.max(0, (nowMs - s.last_reviewed_at) / FSRS_DAY_MS);
  return Math.pow(1 + FSRS_FACTOR * (tDays / s.stability), FSRS_DECAY);
}
function fsrsIntervalDays(s: ConceptMemoryState, requestRetention = 0.9): number {
  if (s.stability <= 0) return 0;
  return (s.stability / FSRS_FACTOR) * (Math.pow(requestRetention, 1 / FSRS_DECAY) - 1);
}
function fsrsDueAt(s: ConceptMemoryState, requestRetention = 0.9): number {
  if (s.last_reviewed_at === null) return 0;
  return s.last_reviewed_at + fsrsIntervalDays(s, requestRetention) * FSRS_DAY_MS;
}
function fsrsIsDue(s: ConceptMemoryState, nowMs: number, requestRetention = 0.9): boolean {
  if (s.reps === 0 || s.last_reviewed_at === null) return true;
  return fsrsDueAt(s, requestRetention) <= nowMs;
}
function fsrsGradeFromAnswer(a: { correct: boolean; hint_count: number }): ReviewGrade {
  if (!a.correct) return 1;
  return a.hint_count > 0 ? 2 : 3;
}
function fsrsInitialStability(g: ReviewGrade, w: FsrsWeights): number {
  const s0 = g === 1 ? w[0] : g === 2 ? w[1] : g === 3 ? w[2] : w[3];
  return Math.max(0.1, s0);
}
function fsrsInitialDifficulty(g: ReviewGrade, w: FsrsWeights): number {
  return fsrsClampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);
}
function fsrsReviewMemory(
  s: ConceptMemoryState, grade: ReviewGrade, nowMs: number, w: FsrsWeights = FSRS_W,
): ConceptMemoryState {
  if (s.reps === 0 || s.last_reviewed_at === null || s.stability <= 0) {
    return {
      ...s,
      stability: fsrsInitialStability(grade, w),
      difficulty: fsrsInitialDifficulty(grade, w),
      last_reviewed_at: nowMs,
      reps: 1,
      lapses: grade === 1 ? 1 : 0,
    };
  }
  const R = fsrsRetrievability(s, nowMs);
  const dNext = fsrsClampD(w[7] * fsrsInitialDifficulty(3, w) + (1 - w[7]) * (s.difficulty - w[6] * (grade - 3)));
  let sNext: number;
  if (grade === 1) {
    const sLapse =
      w[11] * Math.pow(dNext, -w[12]) * (Math.pow(s.stability + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
    sNext = Math.max(0.1, Math.min(sLapse, s.stability));
  } else {
    const hardPenalty = grade === 2 ? w[15] : 1;
    const easyBonus = grade === 4 ? w[16] : 1;
    const inc =
      Math.exp(w[8]) * (11 - dNext) * Math.pow(s.stability, -w[9]) *
      (Math.exp(w[10] * (1 - R)) - 1) * hardPenalty * easyBonus;
    sNext = s.stability * (1 + Math.max(0, inc));
  }
  return {
    ...s,
    stability: sNext,
    difficulty: dNext,
    last_reviewed_at: nowMs,
    reps: s.reps + 1,
    lapses: s.lapses + (grade === 1 ? 1 : 0),
  };
}

/** Per-concept spaced-repetition read surfaced to the learner: is this concept due for review now,
 * when it next falls due, and how strongly retained it currently is. Derived from the learner's
 * answer history via the FSRS scheduler in @studium/adaptation-engine (fsrs.ts) — the engine already
 * *computes* this signal; this read makes it visible to a UI. `concept_id` is the bare id (no
 * `concept:` LWG prefix). */
export interface ReviewQueueItem {
  concept_id: string;
  due: boolean;
  /** Epoch ms when the concept next becomes due for reinforcement (0 = due now / never reviewed). */
  due_at: number;
  /** Current retrievability R(t) ∈ [0,1] — probability the learner still recalls it now. */
  retrievability: number;
  reps: number;
  last_reviewed_at: number | null;
}

/** Qualitative metacognitive-calibration verdict for ONE concept, phrased FOR THE LEARNER. It maps
 * the (hidden) signed `confidence_calibration` to a French message — never exposes the raw number or
 * the live mastery, so the learner gets the reflective signal without the leaderboard. Sign matches
 * fsrs/learner-state: positive ⇒ overconfident (sur), negative ⇒ underconfident (sous). */
export interface CalibrationVerdict {
  concept_id: string;
  /** "bien" | "sur" | "sous" — well- / over- / under-calibrated. */
  band: "bien" | "sur" | "sous";
  message: string;
}

/** Threshold above which a calibration gap is worth naming. Mirrors the engine's calibration rule
 * (|gap| ≥ 0.4 trips an adaptation): below it, "bien calibrée". */
export const CALIBRATION_WELL_BAND = 0.4;

/** Replay a single concept's `answer_submitted` history through the FSRS scheduler (fsrs.ts) to
 * reconstruct its current memory state. Pure: time comes only from the history timestamps. */
function memoryFromHistory(concept_id: string, state: LearnerState): ConceptMemoryState {
  let mem = fsrsDefaultMemory(concept_id);
  for (const h of state.history) {
    const sig = h.signal;
    if (sig.kind !== "answer_submitted" || sig.concept_id !== concept_id) continue;
    const t = Date.parse(h.timestamp);
    if (Number.isNaN(t)) continue;
    mem = fsrsReviewMemory(mem, fsrsGradeFromAnswer({ correct: sig.correct, hint_count: sig.hint_count }), t);
  }
  return mem;
}

/** Derive the spaced-repetition review queue from a LearnerState by replaying each seen concept's
 * answer history through the FSRS scheduler. Concepts with no graded answers (reps=0) are omitted —
 * they are handled by the normal prerequisite-gated path, not by review. Most-urgent (lowest
 * retrievability) first. Exported + pure so a UI/driver and a unit test can call it directly. */
export function reviewQueueFromState(
  state: LearnerState,
  nowMs: number,
  opts: { requestRetention?: number } = {},
): ReviewQueueItem[] {
  const { requestRetention = 0.9 } = opts;
  const items: ReviewQueueItem[] = [];
  for (const concept_id of Object.keys(state.concept_states)) {
    const mem = memoryFromHistory(concept_id, state);
    if (mem.reps === 0) continue;
    items.push({
      concept_id,
      due: fsrsIsDue(mem, nowMs, requestRetention),
      due_at: fsrsDueAt(mem, requestRetention),
      retrievability: fsrsRetrievability(mem, nowMs),
      reps: mem.reps,
      last_reviewed_at: mem.last_reviewed_at,
    });
  }
  return items.sort((a, b) => a.retrievability - b.retrievability);
}

/** Map a concept's hidden `confidence_calibration` to a learner-facing, NUMBER-FREE verdict. Returns
 * null when the concept has no checkpointed calibration yet (calibration === 0 with no attempts).
 * Never leaks mastery or the raw gap. Exported + pure for reuse across the runtime + a unit test. */
export function calibrationVerdict(cs: ConceptState): CalibrationVerdict | null {
  const gap = cs.confidence_calibration;
  // "measured" = a confidence was actually observed. Without a sample, confidence_calibration defaults
  // to 0 (in-band) and a "bien calibrée" verdict would be a FABRICATED reassurance — so gate on the
  // sample count, sharing ONE definition of measured with isCalibrated/isMiscalibrated (learner-state).
  if (cs.total_attempts === 0 || (cs.calibration_samples ?? 0) === 0) return null;
  if (Math.abs(gap) < CALIBRATION_WELL_BAND) {
    return {
      concept_id: cs.concept_id,
      band: "bien",
      message: "Ta confiance était bien calibrée : ton ressenti collait à ta maîtrise réelle.",
    };
  }
  if (gap > 0) {
    return {
      concept_id: cs.concept_id,
      band: "sur",
      message:
        "Tu étais un peu surconfiant·e : tu te sentais plus sûr·e que ne le montrent tes réponses. " +
        "Vérifie ce concept avant de passer à la suite.",
    };
  }
  return {
    concept_id: cs.concept_id,
    band: "sous",
    message:
      "Tu étais un peu sous-confiant·e : tu maîtrises ce concept mieux que tu ne le penses. " +
      "Fais-toi confiance.",
  };
}

export interface SessionHostOptions { bundlesRoot: string; live: boolean; }

export class PeerRoomError extends Error {
  constructor(msg: string) { super(msg); this.name = "PeerRoomError"; }
}

/** Multi-session host shared by the HTTP and MCP drivers. */
export class SessionHost {
  private readonly registry = new SessionRegistry();
  // D1 PeerStudio: ephemeral rooms indexed by id and by join_code.
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly joinCodeIndex = new Map<string, string>(); // join_code → room_id
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

  /** Discover the community (learner-authored, approved) bundle refs sitting alongside the
   * canonical bundle in this host's bundles root. Each returned ref loads through `create()`
   * exactly like the canonical bundle (community-<item_id>.zip → resolveBundle). The canonical
   * course is never mutated; a canonical-only root returns []. */
  async listCommunityBundles(): Promise<string[]> {
    return discoverCommunityBundles(this.opts.bundlesRoot);
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
    const scene = e.session.currentPresentation().scene;
    const assets = sceneRenderAssets(scene).map((a) => inlineFileAsset(a, e.baseDir, e.assetCache));
    // A LEARNER-TIME RUN scene (run_manifest present) WITHHOLDS its author executed run — the learner
    // produces a fresh result by running it (parity with the file channel + publicScene).
    if ((scene as { run_manifest?: unknown }).run_manifest) return assets.filter((a) => a.kind !== "executed_result");
    return assets;
  }
  /** Record a learner-time capsule run (the learner's OWN executed result) on the session, keyed by
   * task_card_id, so a later spot_the_flaw with `reference_from_run` grounds on it. Called after the
   * host ingests the operator's run_result.json (run protocol) — closes the operation→judgment loop. */
  recordLearnerRun(id: string, taskCardId: string, run: ReferenceRun): void {
    this.require(id).session.recordLearnerRun(taskCardId, run);
  }

  /** The learner-time RUN manifest for the current scene (the provisioning/run instructions a
   * reproduction scene needs), or null when the current scene is not a learner-run scene.
   * NON-answer-bearing — capsule ref / install / cmd / produced file names / file-existence checks. */
  runManifest(id: string): RunManifest | null {
    const scene = this.require(id).session.currentPresentation().scene as { run_manifest?: RunManifest };
    return scene.run_manifest ?? null;
  }

  /** Ingest a learner-produced run_result — Studium NEVER executes (the operator ran it in the workspace).
   * The SHARED run-ingest core used by BOTH channels (MCP submit_run_result + the file channel's
   * SessionWorkspace.ingestRun), so they cannot drift. Gates advance on `ran && passed`: a passing run
   * records the learner's OWN executed result (keyed by the run scene's task_card_id, so a later
   * reference_from_run judgment grounds on it) and advances via an ack; a non-completed / failed-checks
   * run does NOT advance. Guards a non-run scene (no run_manifest) so it never advances an arbitrary scene. */
  async ingestRunResult(
    id: string, result: RunResult,
  ): Promise<{ status: "ran" | "run_incomplete" | "run_failed_checks" | "not_a_run_scene"; transition: Transition | null; learnerRunRecorded: boolean }> {
    const scene = this.require(id).session.currentPresentation().scene as { run_manifest?: unknown; task_card_id?: string };
    if (!scene.run_manifest) return { status: "not_a_run_scene", transition: null, learnerRunRecorded: false };
    if (!result.ran) return { status: "run_incomplete", transition: null, learnerRunRecorded: false };
    if (!result.passed) return { status: "run_failed_checks", transition: null, learnerRunRecorded: false };
    let learnerRunRecorded = false;
    if (scene.task_card_id) {
      this.recordLearnerRun(id, scene.task_card_id, runResultToReferenceRun(result));
      learnerRunRecorded = true;
    }
    const transition = await this.respond(id, { kind: "ack" } as ResponseInput);
    return { status: "ran", transition, learnerRunRecorded };
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
  /** Spaced-repetition read: per concept, whether it is due for review now (per the FSRS scheduler
   * in @studium/adaptation-engine), when it next falls due, and its current retrievability. Derived
   * from the learner's running answer history, replayed through fsrs.ts. `nowMs` is injectable for
   * deterministic tests; defaults to wall-clock. A UI renders the due items as a "À réviser" cue. */
  reviewQueue(id: string, nowMs: number = Date.now()): ReviewQueueItem[] {
    return reviewQueueFromState(this.require(id).session.getState(), nowMs);
  }

  /** Learner-facing metacognitive-calibration verdicts (number-free, mastery never leaked) for every
   * concept that has a checkpointed confidence gap. The student-facing complement to the engine's
   * calibration rule: after a meta_checkpoint a UI shows "ta confiance était bien/sur/sous-calibrée".
   * Pass a `concept_id` to scope to one concept. */
  calibrationFor(id: string, concept_id?: string): CalibrationVerdict[] {
    const state = this.require(id).session.getState();
    // Only concepts where the learner ACTUALLY declared a confidence (a meta_checkpoint ran for it)
    // have a real calibration gap; a never-checkpointed concept keeps the default
    // confidence_calibration=0, which calibrationVerdict would otherwise turn into a fabricated
    // "bien calibré" verdict. Gate on the history (where confidence_declared lives), not total_attempts.
    const declared = new Set(
      state.history.flatMap((h) =>
        h.signal.kind === "confidence_declared" && h.signal.concept_id ? [h.signal.concept_id] : []),
    );
    const entries = concept_id
      ? (declared.has(concept_id) && state.concept_states[concept_id] ? [state.concept_states[concept_id]] : [])
      : Object.values(state.concept_states).filter((cs) => declared.has(cs.concept_id));
    return entries.map(calibrationVerdict).filter((v): v is CalibrationVerdict => v !== null);
  }

  has(id: string): boolean { return this.registry.has(id); }

  // ---------------------------------------------------------------------------
  // D1 PeerStudio — ephemeral room API (teacher-gated)
  // ---------------------------------------------------------------------------

  /** Teacher creates a Room; returns an opaque teacher_key and a human-typable join_code. */
  openRoom(bundleRef: string): { room_id: string; join_code: string; teacher_key: string } {
    const room_id = randomUUID();
    const teacher_key = randomUUID();
    const join_code = room_id.replace(/-/g, "").slice(0, 6).toUpperCase();
    const room: RoomEntry = {
      id: room_id, teacher_key, bundle_ref: bundleRef,
      join_code, session_ids: new Set(), ratings: [],
      created_at: Date.now(), closed: false,
    };
    this.rooms.set(room_id, room);
    this.joinCodeIndex.set(join_code, room_id);
    return { room_id, join_code, teacher_key };
  }

  /** Learner joins an open Room by its human-typable join_code, linking their session into it. */
  joinRoom(joinCode: string, sessionId: string): { room_id: string; session_count: number } {
    const room_id = this.joinCodeIndex.get(joinCode.toUpperCase());
    if (!room_id) throw new PeerRoomError(`unknown join code: ${joinCode}`);
    const room = this.rooms.get(room_id)!;
    if (room.closed) throw new PeerRoomError("room is already closed");
    room.session_ids.add(sessionId);
    return { room_id, session_count: room.session_ids.size };
  }

  /** Learner submits a peer rating for another session's response.
   *  Returns whether the target is still k-suppressed after this rating. */
  submitRoomRating(
    roomId: string,
    raterSessionId: string,
    targetSessionId: string,
    rating: { passed: boolean; rating: number; helpful: boolean },
  ): { suppressed: boolean; k: number } {
    const room = this.rooms.get(roomId);
    if (!room) throw new PeerRoomError(`unknown room: ${roomId}`);
    if (room.closed) throw new PeerRoomError("room is already closed");
    if (raterSessionId === targetSessionId) throw new PeerRoomError("cannot rate your own response");
    if (rating.rating < 1 || rating.rating > 5) throw new PeerRoomError("rating must be 1–5");
    room.ratings.push({
      rater_session_id: raterSessionId,
      target_session_id: targetSessionId,
      ...rating,
      ts: Date.now(),
    });
    const k = room.ratings.filter((r) => r.target_session_id === targetSessionId).length;
    return { suppressed: k < ROOM_K_FLOOR, k };
  }

  /** Teacher reads the current Room state (session count, rating count, k-suppressed aggregates).
   *  Gated by the teacher_key so only the teacher sees the live aggregates. */
  getRoomState(roomId: string, teacherKey: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new PeerRoomError(`unknown room: ${roomId}`);
    if (room.teacher_key !== teacherKey) throw new PeerRoomError("invalid teacher key");
    return {
      room_id: roomId,
      bundle_ref: room.bundle_ref,
      session_count: room.session_ids.size,
      rating_count: room.ratings.length,
      closed: room.closed,
      aggregates: aggregateRatings(room.ratings),
    };
  }

  /** Teacher closes the Room; returns the final k-suppressed aggregates for decide_item routing. */
  closeRoom(roomId: string, teacherKey: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new PeerRoomError(`unknown room: ${roomId}`);
    if (room.teacher_key !== teacherKey) throw new PeerRoomError("invalid teacher key");
    room.closed = true;
    this.joinCodeIndex.delete(room.join_code);
    return {
      room_id: roomId,
      bundle_ref: room.bundle_ref,
      session_count: room.session_ids.size,
      rating_count: room.ratings.length,
      closed: true,
      aggregates: aggregateRatings(room.ratings),
    };
  }

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
