// packages/lesson-session-host/src/host.ts
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { mkdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join, isAbsolute, relative, dirname, resolve } from "node:path";
import {
  LessonSession, enrichEvent, bundleVersionOf,
  type Presentation, type ResponseInput, type Transition, type Explanation, type HintResult,
  type SelfRatingRequest,
} from "@studium/lesson-session";
import {
  masteryOf, defaultLearnerState, defaultLearnerProfile,
  seedConceptStatesFromProfile, mergeConceptStatesIntoProfile, mergeConceptMemoryIntoProfile, recordCompletedLesson,
  type ConceptState, type LearnerProfile, type LearnerState,
} from "@studium/learner-state";
import {
  PROFILE_PSEUDONYM_SCOPE, FileLearnerProfileStore, InMemoryLearnerProfileStore, type LearnerProfileStore,
} from "./learner-profile-store.js";
import type { JudgmentGenerator } from "./judgment-generator.js";
import {
  sceneRenderAssets, nextCourseLesson, isCourseComplete,
  type RenderAsset, type ReferenceRun, type RunManifest, type Course, type CourseLesson, type LessonBundle, type Scene,
} from "@studium/lesson-bundle-schema";
import { runResultToReferenceRun, verifyRunAttestation, type RunResult } from "./run-result.js";
import { buildConceptMap, type ConceptMap, type ConceptMapMoment } from "./concept-map.js";
import type { GraphView } from "@studium/typed-graph-lens";
import { lwgToGraphView } from "@studium/typed-graph-lens/adapters/studium";
import { SessionRegistry, type HeldSources, type SessionEntry } from "./registry.js";
import type { Clock } from "@studium/lesson-session";
import { ExperimentJournal, experimentRevision, type ExperimentDocument } from "./experiment-journal.js";
import { buildHostDeps, durableDataDir, durableScopeDir, envPseudoSecret } from "./deps.js";
import {
  installSecret, currentInstallSecret, holdsLearners, markEnvKeyed, SECRET_FILE, KEY_SOURCE_FILE, LEGACY_PSEUDO_SECRET,
  type InstallSecret,
} from "./pseudonym-secret.js";
import { LearnerDataError, tightenFolder, withLearnerLock, readLearnerTombstone, writeLearnerTombstone } from "./learner-files.js";
import { removeStatusFile, statusFileOwner, writeStatusFile } from "./status-file.js";
import { loadResolvedBundle } from "./bundle-resolver.js";
import { discoverCommunityBundleEntries, type CommunityBundleEntry } from "./community-bundles.js";
import { authoringOf, readApproval, draftedByOf, type AuthoringBlock, type DraftedBy } from "./authoring.js";
import {
  aggregateRatings, distinctRaters, ROOM_K_FLOOR,
  type RoomEntry, type RoomState,
} from "./room.js";
import {
  defaultMemoryState, retrievability, dueAt, isDue, reviewMemory, gradeFromAnswer, reinforcementPriority,
  dueForReinforcement, type ConceptMemoryState, type SelfRating,
} from "./fsrs-memory.js";
import { publicScene, citedSources, type CitedSource, type PublicPresentation, type PublicTransition } from "./public-scene.js";
import { buildConceptMapRecord, type ConceptMapRecord } from "./concept-map-record.js";
import {
  presentationMarkdown, transitionMarkdown, verdictMarkdown, recallRatedMarkdown, nothingToReviewMarkdown,
  lessonListMarkdown, forgetMarkdown, conceptMapExportMarkdown, completionSplit, completionGroupsMarkdown, type CompletionSplit, type DisplayLocale,
} from "./chat-display.js";
import { OffsetClock, checkNowMs } from "./session-clock.js";
import { calendarDate, checkTimeZone, localTimeZone } from "./calendar.js";
import { scanCatalog, type Catalog, type CatalogLesson, type LessonRoot } from "./lesson-catalog.js";
import { buildStudyPlan, scheduleFromMemory, type StudyPlan } from "./study-plan.js";
import {
  emptyStudyRecord, FileStudyRecordStore, InMemoryStudyRecordStore,
  type ConceptRoute, type StudyRecord, type StudyRecordStore,
} from "./study-record.js";
import {
  RETRIEVAL_SCENE_TYPES, REVIEW_BUNDLE_ID, DEFAULT_REVIEW_ITEMS, MAX_REVIEW_ITEMS, buildReviewBundle, pickReviewScene,
  type ReviewSource,
} from "./review-session.js";
import { persistenceInfo, DEFAULT_LEARNER_ID, type PersistenceInfo } from "./persistence.js";
import { replyToInput, checkDisplayedChoice } from "./reply-mapping.js";
import {
  authorVoice, orientationFacts, orientationFrom, recordNavigation, statusLine, voiceLine, type OrientationFacts, type Voice,
} from "./orientation.js";
import type { HostResponseInput } from "./response-input-schema.js";

// Text-based render-asset kinds whose payload can be served inline from a file path (so a webview /
// notebook gets the content directly — no client-side file access, CSP-safe). Images stay as paths
// (the driver converts those to data URIs). A .cube orbital and an .xyz molecule are plain text.
const TEXT_INLINE_KINDS = new Set<RenderAsset["kind"]>([
  "orbital", "mol_3d", "spectrum", "code", "data_csv", "protocol_md", "svg",
]);

function normalizePresentationLanguage(language: string): string {
  const trimmed = language.trim();
  if (!trimmed) throw new Error("Presentation language must be a valid BCP 47 language tag");
  try {
    const [canonical] = Intl.getCanonicalLocales(trimmed);
    if (!canonical) throw new Error();
    return canonical;
  } catch {
    throw new Error("Presentation language must be a valid BCP 47 language tag");
  }
}

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

/** RFR-14, R-en-06: an unknown session id says how to go on, in one line. It still starts with
 * « session not found: », which the HTTP adapter maps to a 404. */
export class SessionHostNotFoundError extends Error {
  /** `erased` (L-11): the learner's data was erased — by forget_session here or in another server on
   * the same data folder, or the folder itself — while the session was open. */
  constructor(id: string, cause: "unknown" | "erased" = "unknown") {
    super(cause === "erased"
      ? `session not found: ${id} (the learner's data was erased while this session was open): call ` +
        "start_lesson_session with the same bundle_ref and learner_id to start the lesson afresh, or " +
        "start_review_session with the same learner_id for a review"
      : `session not found: ${id} (the server may have restarted, or the session was closed): call ` +
        "start_lesson_session with the same bundle_ref and learner_id to resume the lesson where it stopped, or " +
        "start_review_session with the same learner_id to start the review again");
    this.name = "SessionHostNotFoundError";
  }
}

export const RUN_REQUIRED_MESSAGE =
  "run required: call get_run_manifest, run it, then submit_run_result";

/** Raised when a response attempts to bypass a learner-time run. */
export class RunRequiredError extends Error {
  constructor() { super(RUN_REQUIRED_MESSAGE); this.name = "RunRequiredError"; }
}

// ---------------------------------------------------------------------------------------------
// FSRS memory (RT-3). The scheduler is packages/adaptation-engine/src/fsrs.ts, imported through
// ./fsrs-memory.ts — this file used to carry a hand-kept copy of it. The memory itself is first-class:
// the engine folds every graded answer into `LearnerState.concept_memory`, the host folds the
// learner's self-ratings and writes the memory through to the cross-lesson profile after each of
// them. Replaying the answer history (capped at 50 entries) only remains for a state saved before
// the memory existed, once, when it is resumed.
// ---------------------------------------------------------------------------------------------

/** Per-concept spaced-repetition read surfaced to the learner: is this concept due for review now,
 * when it next falls due, and how strongly retained it currently is. `concept_id` is the bare id (no
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
 * reconstruct its current memory state. Pure: time comes only from the history timestamps.
 *
 * `seed` = a PRIOR (cross-lesson) memory for this concept (the learner profile's accumulated
 * `concept_memory`). When given, the replay starts FROM it instead of a fresh default, so a concept
 * re-reviewed in a later lesson ACCUMULATES stability (A+B) rather than restarting (B-only).
 *
 * What is and isn't deduplicated. The seed already accounts for every answer up to its
 * `last_reviewed_at`; on a RESUME of the same bundle the loaded prior history still HOLDS those answers,
 * so we must not re-fold them. We dedupe by TIMESTAMP: an answer at/before `seed.last_reviewed_at` is
 * "already in the seed" → skipped; a genuinely NEW answer (strictly later) is folded and legitimately
 * ACCUMULATES. So re-answering a scene at a later time IS a real retrieval and DOES bump reps (the
 * loaded prior events do not) — this is intended cross-lesson spaced repetition, not a double count.
 *
 * Timestamp-dedup bound (the history carries no per-event identity): if the clock is non-monotonic
 * across sessions/machines — a genuine new answer whose wall-clock is <= the seed's last review
 * (cross-machine skew, or a same-ms tie) — it is CONSERVATIVELY skipped rather than risk re-folding an
 * already-seeded event. That under-counts that one review (it NEVER double-counts and never regresses
 * the seed) and self-heals on the next in-order review. */
function memoryFromHistory(
  concept_id: string,
  state: LearnerState,
  seed?: ConceptMemoryState,
): ConceptMemoryState {
  // Only a WELL-FORMED prior is a usable FSRS anchor (reps≥1 ⇒ stability>0 ⇒ a real last review). A
  // malformed seed (e.g. a hand-migrated profile with reps≥1 yet stability≤0 / null last) would trip
  // reviewMemory's re-init branch and SILENTLY reset reps→1; treat it as no anchor and replay this
  // session's history from scratch instead (predictable, never a half-reset). Internally-produced
  // profiles are always well-formed, so this only guards externally-written/migrated profile.json.
  const usableSeed =
    seed && seed.reps >= 1 && seed.stability > 0 && seed.last_reviewed_at !== null ? seed : undefined;
  let mem = usableSeed ? { ...usableSeed, concept_id } : defaultMemoryState(concept_id);
  const seededThrough = usableSeed?.last_reviewed_at ?? null; // answers <= this are already in the seed
  for (const h of state.history) {
    const sig = h.signal;
    if (sig.kind !== "answer_submitted" || sig.concept_id !== concept_id) continue;
    // INT-STUDIUM-035 candidate 2: an answer nobody graded is not a retrieval with an outcome, so
    // it is not replayed at all. It matters that this is a SKIP and not a default: `gradeFromAnswer`
    // reads `if (!a.correct) return 1`, so an absent field would have been folded as grade 1
    // ("again") — the hardest failure — and an ungraded concept would come back urgently due.
    if (sig.correct === undefined) continue;
    const t = Date.parse(h.timestamp);
    if (Number.isNaN(t)) continue;
    if (seededThrough !== null && t <= seededThrough) continue; // already in the seed — don't re-fold
    mem = reviewMemory(mem, gradeFromAnswer({ correct: sig.correct, hint_count: sig.hint_count }), t);
  }
  return mem;
}

/** Rebuild the per-concept FSRS memory of a LearnerState by REPLAYING its answer history — the path
 * for a state saved before `concept_memory` was first-class (RT-3), and the one-time migration of such
 * a state when it is resumed. Pure; exported so a test can pin the replay.
 *
 * `seed` = the learner profile's accumulated cross-lesson `concept_memory`. When given, each concept's
 * replay STARTS from its prior memory (idempotently — see memoryFromHistory), so re-reviewing a concept
 * in a later lesson ACCUMULATES (A+B) instead of restarting (B-only).
 *
 * CAVEAT: `state.history` is a rolling window capped at 50 entries, so for a lesson with >50 total
 * signals the earliest answers are evicted and reps/stability under-count — the reason the memory is
 * now kept first-class instead (see memoryOfState). */
export function conceptMemoryFromState(
  state: LearnerState,
  seed?: Record<string, ConceptMemoryState>,
): Record<string, ConceptMemoryState> {
  const out: Record<string, ConceptMemoryState> = {};
  for (const concept_id of Object.keys(state.concept_states)) {
    out[concept_id] = memoryFromHistory(concept_id, state, seed?.[concept_id]);
  }
  return out;
}

/** A state's FSRS memory: its first-class `concept_memory` when it has one, else the history replay
 * (a state saved before RT-3, or built by hand). */
function memoryOfState(state: LearnerState): Record<string, ConceptMemoryState> {
  return state.concept_memory ?? conceptMemoryFromState(state);
}

/** Derive the spaced-repetition review queue from a LearnerState's FSRS memory. Concepts with no
 * graded answers (reps=0) are omitted — they are handled by the normal prerequisite-gated path, not by
 * review. Most-urgent (lowest retrievability) first. Exported + pure so a UI/driver and a unit test can
 * call it directly. */
export function reviewQueueFromState(
  state: LearnerState,
  nowMs: number,
  opts: { requestRetention?: number } = {},
): ReviewQueueItem[] {
  return reviewQueueFromMemory(memoryOfState(state), nowMs, opts.requestRetention);
}

function reviewQueueFromMemory(
  memory: Record<string, ConceptMemoryState>,
  nowMs: number,
  requestRetention = 0.9,
): ReviewQueueItem[] {
  return Object.values(memory)
    .filter((entry) => entry.reps > 0)
    .map((entry) => ({
      concept_id: entry.concept_id,
      due: isDue(entry, nowMs, requestRetention),
      due_at: dueAt(entry, requestRetention),
      retrievability: retrievability(entry, nowMs),
      reps: entry.reps,
      last_reviewed_at: entry.last_reviewed_at,
    }))
    .sort((a, b) => a.retrievability - b.retrievability);
}

/** The most-urgent concept to reinforce now (the FSRS ROUTER decision), or null. */
export interface ReinforcementTarget {
  concept_id: string;
  /** Epoch ms when the concept fell due for reinforcement. */
  due_at: number;
  /** Current retrievability R(t) ∈ [0,1] (lower ⇒ more urgent). */
  retrievability: number;
}

export interface RoutedReinforcementTarget extends ReinforcementTarget {
  /** A scene to review it with: in the live session's lesson when it covers the concept, else the
   * scene of `bundle_ref` the concept was last graded in. */
  scene_id: string | null;
  source: "session" | "profile";
  /** HJ-1: the lesson of `scene_id` when it is not the live session's own. */
  bundle_ref?: string;
  lesson_title?: string;
}

export interface ReinforcementStatus {
  /** Mastered concepts whose recall is due, most urgent first. */
  due: RoutedReinforcementTarget[];
  /** HJ-1: reviewed concepts graded below the mastery gate whose review is due (lapses, weak ones). */
  relearn: RoutedReinforcementTarget[];
  /** I-3: reviewed concepts no graded attempt measured (self-rated only) whose review is due — due for
   * review, never called weak. */
  unmeasured: RoutedReinforcementTarget[];
  has_history: boolean;
  /** The earliest review still in the FUTURE, or null — never a date already past. */
  next_due_at: number | null;
}

interface RankedReinforcementTarget extends ReinforcementTarget {
  priority: number;
}

/** The next step a learner should take in a course, auto-routed by FSRS: reinforce a decayed concept,
 * advance to the next lesson, the course is done, or it's blocked (lessons remain but none is unlocked —
 * a mis-authored unmet/cyclic prereq). `reinforce` PREEMPTS `advance` (spaced repetition first). */
export type CourseStep =
  | ({ kind: "reinforce" } & ReinforcementTarget)
  | { kind: "advance"; lesson: CourseLesson }
  | { kind: "done" }
  | { kind: "blocked" };

/** FSRS as a ROUTER (not a readout): the single most-urgent concept to reinforce now for this
 * LearnerState, or null. Reads the state's FSRS memory, gates on mastery (masteryOf ≥ minMastery)
 * and due-ness, and picks the top-priority concept. Pure; `nowMs` injected for determinism. */
export function nextReinforcementFromState(
  state: LearnerState,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): ReinforcementTarget | null {
  return dueReinforcementsFromState(state, nowMs, opts)[0] ?? null;
}

/** Every due concept in a session, in the authoritative FSRS reinforcement order. */
export function dueReinforcementsFromState(
  state: LearnerState,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): ReinforcementTarget[] {
  return dueReinforcementTargetsFromMemory(memoryOfState(state), masteryFromState(state), nowMs, opts);
}

/** ROUTE the FSRS decision to CONTENT: the bundle scene that addresses the most-urgent due concept
 * (its `concept_refs` includes that concept), preferring an active RETRIEVAL scene (quiz / spot_the_flaw
 * / explain_back / comparison / summary_audit / prompt_practice) over a passive intro, and falling back
 * to the first covering scene of any type. Null when nothing is due / no scene covers it. Pure; the
 * host wraps it with the live session's bundle + state. */
export function reinforcementSceneFromState(
  bundle: LessonBundle,
  state: LearnerState,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): string | null {
  const target = nextReinforcementFromState(state, nowMs, opts);
  if (!target) return null;
  return reinforcementSceneForConcept(bundle, target.concept_id);
}

/** Map one concept to the current bundle's preferred active-retrieval scene. */
export function reinforcementSceneForConcept(bundle: LessonBundle, conceptId: string): string | null {
  const covers = (s: LessonBundle["scenes"][number]): boolean =>
    (s.concept_refs ?? []).includes(conceptId);
  // Prefer an active RETRIEVAL scene (re-test recall) over a passive intro/exposition; fall back to
  // the first covering scene of any type when the bundle has no retrieval scene for the concept.
  const scene = bundle.scenes.find((s) => covers(s) && RETRIEVAL_SCENE_TYPES.has(s.type)) ??
    bundle.scenes.find(covers);
  return scene?.id ?? null;
}

/** CROSS-LESSON reinforcement router: every concept DUE for reinforcement now, most-urgent first, from a
 * PERSISTED FSRS memory map (the learner profile's `concept_memory`, accumulated across lessons) + a
 * per-concept mastery map. Spans lessons — a concept mastered + reviewed in lesson A can surface as due
 * while the learner is elsewhere. Pure; `nowMs` injected. */
export function dueReinforcementTargetsFromMemory(
  memory: Record<string, ConceptMemoryState>,
  mastery: Record<string, number>,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): ReinforcementTarget[] {
  return rankedDueTargetsFromMemory(memory, mastery, nowMs, opts).map(({ priority: _priority, ...target }) => target);
}

function rankedDueTargetsFromMemory(
  memory: Record<string, ConceptMemoryState>,
  mastery: Record<string, number>,
  nowMs: number,
  opts: { requestRetention?: number; minMastery?: number } = {},
): RankedReinforcementTarget[] {
  return dueForReinforcement(memory, mastery, nowMs, opts).map((cid) => {
    const m = memory[cid] as ConceptMemoryState;
    const r = retrievability(m, nowMs);
    return {
      concept_id: cid,
      due_at: dueAt(m, opts.requestRetention),
      retrievability: r,
      priority: reinforcementPriority(mastery[cid] ?? 0, r),
    };
  });
}

function masteryFromState(state: LearnerState): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state.concept_states).map(([conceptId, conceptState]) => [conceptId, masteryOf(conceptState)]),
  );
}

function masteryFromProfile(profile: LearnerProfile | null): Record<string, number> {
  return profile ? Object.fromEntries(
    Object.entries(profile.concept_states).map(([conceptId, conceptState]) => [conceptId, masteryOf(conceptState)]),
  ) : {};
}

/** I-3: the concepts a graded attempt measured. A concept only self-rated (C4) or never graded keeps
 * its prior mastery, which says nothing about the learner: it is not « weak ». */
function measuredOf(conceptStates: Readonly<Record<string, { total_attempts: number }>> | undefined): Set<string> {
  return new Set(Object.entries(conceptStates ?? {}).filter(([, cs]) => cs.total_attempts > 0).map(([conceptId]) => conceptId));
}

/** A target with the scene to review it with: in `bundle` when it covers the concept, else the scene
 * the study record says the concept was last graded in (HJ-1: a learner-only query used to get null). */
function routedTarget(
  bundle: LessonBundle | null,
  source: RoutedReinforcementTarget["source"],
  target: ReinforcementTarget,
  record: StudyRecord | null,
): RoutedReinforcementTarget {
  const here = bundle ? reinforcementSceneForConcept(bundle, target.concept_id) : null;
  const route = here === null ? record?.concepts[target.concept_id] : undefined;
  return {
    concept_id: target.concept_id,
    scene_id: here ?? route?.scene_id ?? null,
    due_at: target.due_at,
    retrievability: target.retrievability,
    source,
    ...(route ? { bundle_ref: route.bundle_ref, lesson_title: route.lesson_title } : {}),
  };
}

function pick<T>(map: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => keys.has(key)));
}
function omit<T>(map: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([key]) => !keys.has(key)));
}
function earliest(...times: Array<number | null>): number | null {
  const known = times.filter((t): t is number => t !== null);
  return known.length ? Math.min(...known) : null;
}

/** Reinforcement status over one memory map, before the due targets are routed: the due (mastered)
 * concepts ranked by priority, the relearn (weak) ones routed, and the earliest review still ahead. */
function statusOf(
  memory: Record<string, ConceptMemoryState>,
  mastery: Record<string, number>,
  measured: ReadonlySet<string>,
  nowMs: number,
  source: RoutedReinforcementTarget["source"],
  bundle: LessonBundle | null,
  record: StudyRecord | null,
): Omit<ReinforcementStatus, "due"> & { ranked: Array<{ source: RoutedReinforcementTarget["source"]; target: RankedReinforcementTarget }> } {
  const schedule = scheduleFromMemory(memory, mastery, nowMs, measured);
  return {
    ranked: rankedDueTargetsFromMemory(memory, mastery, nowMs).map((target) => ({ source, target })),
    relearn: schedule.relearn.map((target) => routedTarget(bundle, source, target, record)),
    unmeasured: schedule.unmeasured.map((target) => routedTarget(bundle, source, target, record)),
    has_history: schedule.has_history,
    next_due_at: schedule.next_due_at,
  };
}

function isLessonCompleted(bundle: LessonBundle, state: LearnerState, profile: LearnerProfile | null): boolean {
  if (profile?.completed_lessons?.includes(bundle.bundle_id)) return true;
  const completed = new Set(state.scenes_completed);
  return bundle.scenes.every((scene) => completed.has(scene.id));
}

function resumeFor(
  bundle: LessonBundle,
  state: LearnerState,
  profile: LearnerProfile | null,
  sceneId: string,
): SessionResume {
  const completedByProfile = profile?.completed_lessons?.includes(bundle.bundle_id) ?? false;
  const completedIds = new Set(state.scenes_completed);
  const completedCount = completedByProfile
    ? bundle.scenes.length
    : bundle.scenes.filter((scene) => completedIds.has(scene.id)).length;
  const kind = isLessonCompleted(bundle, state, profile) ? "completed" : completedCount > 0 ? "resumed" : "new";
  return { kind, scene_id: sceneId, scenes_completed: completedCount };
}

function routedProfileDue(
  profile: LearnerProfile | null,
  bundle: LessonBundle,
  nowMs: number,
  record: StudyRecord | null,
): RoutedReinforcementTarget[] {
  if (!profile?.concept_memory) return [];
  return rankedDueTargetsFromMemory(profile.concept_memory, masteryFromProfile(profile), nowMs)
    .map((target) => routedTarget(bundle, "profile", target, record));
}

/** Which of two memories of one concept is the more recent: by last review, then by review count;
 * a tie goes to `b` (the caller passes the cross-lesson memory there). */
function newest(a: ConceptMemoryState | undefined, b: ConceptMemoryState | undefined): ConceptMemoryState | undefined {
  if (!a || a.reps === 0) return b && b.reps > 0 ? b : undefined;
  if (!b || b.reps === 0) return a;
  const at = (m: ConceptMemoryState) => m.last_reviewed_at ?? Number.NEGATIVE_INFINITY;
  if (at(a) !== at(b)) return at(a) > at(b) ? a : b;
  return a.reps > b.reps ? a : b;
}

/** The FSRS memory a lesson session starts from (RT-3): for each concept of the lesson, the more recent
 * of the lesson's own saved memory and the learner's cross-lesson memory, so a concept reviewed in
 * another lesson continues there instead of restarting. A lesson state saved before the memory was
 * first-class carries none: its history is replayed once, seeded from the profile (the old path, with
 * its timestamp deduplication), and the session saves the result. */
function startingMemory(
  prior: LearnerState | null,
  profile: LearnerProfile | null,
  conceptIds: readonly string[],
): Record<string, ConceptMemoryState> {
  const carried = profile?.concept_memory ?? {};
  const saved = prior ? prior.concept_memory ?? conceptMemoryFromState(prior, carried) : {};
  const out: Record<string, ConceptMemoryState> = {};
  for (const conceptId of new Set([...conceptIds, ...Object.keys(saved)])) {
    const latest = newest(saved[conceptId], carried[conceptId]);
    if (latest) out[conceptId] = { ...latest, concept_id: conceptId };
  }
  return out;
}

/** The entries of `memory` at least as recent as their counterpart in `existing` (a concurrent
 * session of the same learner may have written a newer review). */
function notOlderThan(
  memory: Record<string, ConceptMemoryState>,
  existing: Record<string, ConceptMemoryState> | undefined,
): Record<string, ConceptMemoryState> {
  return Object.fromEntries(Object.entries(memory).filter(([conceptId, m]) =>
    m.reps > 0 && newest(m, existing?.[conceptId]) === m || existing?.[conceptId] === undefined));
}

const sameReview = (a: ConceptMemoryState | undefined, b: ConceptMemoryState): boolean =>
  a !== undefined && a.reps === b.reps && a.last_reviewed_at === b.last_reviewed_at;

/** The last graded answer to `conceptId` in the history (the one a respond just appended). */
function lastGradedAnswer(state: LearnerState, conceptId: string): { correct: boolean; hint_count: number; at: number } | null {
  for (let i = state.history.length - 1; i >= 0; i -= 1) {
    const { signal, timestamp } = state.history[i]!;
    if (signal.kind !== "answer_submitted" || signal.concept_id !== conceptId || signal.correct === undefined) continue;
    const at = Date.parse(timestamp);
    return Number.isNaN(at) ? null : { correct: signal.correct, hint_count: signal.hint_count, at };
  }
  return null;
}

/** Concepts graded in a lesson state's (capped) history. */
function gradedInHistory(state: LearnerState): Set<string> {
  return new Set(state.history.flatMap(({ signal }) =>
    signal.kind === "answer_submitted" && signal.correct !== undefined ? [signal.concept_id] : []));
}

/** Lesson choices keep their order across resumes; the optional learner salt preserves the existing
 * class analytics policy. Reviews use their own learner-and-calendar-day salt. */
function shuffleSaltFor(learnerId: string): string {
  return process.env["STUDIUM_PER_LEARNER_SHUFFLE"] ? learnerId : "";
}

function displayLocale(language: string | undefined): DisplayLocale {
  return LessonSession.localeFromLanguage(language) === "en" ? "en" : "fr";
}

/** L-4: the language the study tools speak when neither the call nor the learner's lessons say. */
const DEFAULT_LOCALE: DisplayLocale = "en";

/** L-4: a `language` argument of the study tools — fr or en — else one readable line. */
function checkLocale(language: string): DisplayLocale {
  if (language === "fr" || language === "en") return language;
  throw new RangeError(`language must be fr or en (got ${JSON.stringify(language)})`);
}

const conceptsOf = (scene: Scene): readonly string[] => ("concept_refs" in scene ? scene.concept_refs : []);
/** One line of an equation's legend: what a symbol stands for. */
export type NotationEntry = NonNullable<RenderAsset["legend"]>[number];
/** Normalize authored answer text for the conservative pre-retry reveal check. */
function normalizedRevealText(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Whether `answer` occurs in `feedback` with Unicode alphanumeric token boundaries. */
function containsWholeAnswer(feedback: string, answer: string): boolean {
  const text = normalizedRevealText(feedback);
  const needle = normalizedRevealText(answer);
  if (needle.length === 0 || needle.length > text.length) return false;
  for (let start = 0; start <= text.length - needle.length; start += 1) {
    if (needle.every((token, offset) => text[start + offset] === token)) return true;
  }
  return false;
}

/** Whether a wrong quiz's authored feedback states one of its keyed choices. */
function feedbackRevealsCorrectChoice(scene: Scene | undefined, verdict: Verdict): boolean {
  if (scene?.type !== "quiz" || verdict.correct !== false || verdict.feedback === undefined) return false;
  return scene.choices.some((choice) => choice.correct && containsWholeAnswer(verdict.feedback!, choice.text));
}

/** I-2: whether an answer leaves its scene for good — a right answer, the end of the session, or a
 * next scene that is neither the same item again (a replay, or a detour that returns to it) nor
 * another item on the same point reached by a detour (remediate_alt, or a prerequisite gate that
 * sends the learner to an unseen item of the concept just answered). */
function leavesForGood(transition: Transition, answered: Scene): boolean {
  if (transition.verdict?.correct === true || transition.kind === "complete") return true;
  const next = transition.presentation.scene;
  if (next.id === answered.id || transition.navigation?.returns_to === answered.id) return false;
  if (transition.kind !== "replay" && transition.kind !== "remediate_alt" && transition.kind !== "remediate") return true;
  const concepts = new Set(conceptsOf(answered));
  return !conceptsOf(next).some((id) => concepts.has(id));
}

/** I-2: the passages a verdict releases. An answer that does not leave its scene holds that scene's
 * passages back on the entry; one that leaves it releases them with the passages held back on the
 * same scene or the same point, and the end of the session releases all that is still held. */
function releasedSources(entry: SessionEntry, transition: Transition, answered: Scene | undefined, leaving: boolean): CitedSource[] {
  const own = answered && transition.verdict?.graded ? citedSources(answered) : [];
  if (answered && !leaving) {
    if (own.length) entry.withheldSources.push({ sceneId: answered.id, conceptIds: conceptsOf(answered), sources: own });
    return [];
  }
  const concepts = new Set(answered ? conceptsOf(answered) : []);
  const settled = (held: HeldSources) => transition.kind === "complete" || held.sceneId === answered?.id
    || held.conceptIds.some((id) => concepts.has(id));
  const released = entry.withheldSources.filter(settled);
  entry.withheldSources = entry.withheldSources.filter((held) => !settled(held));
  return uniqueSources([...released.flatMap((held) => held.sources), ...own]);
}

type Verdict = NonNullable<Transition["verdict"]>;
/** INT-STUDIUM-058: the two lines a screen's conversation text says about itself (screenLines). */
interface ScreenLines { statusLine: string; voiceLine?: string }

const hasReference = (verdict: Verdict | undefined): boolean => (verdict?.key_points?.length ?? 0) > 0
  || verdict?.model_answer !== undefined;

/** A verdict without its reference, nor answer-revealing quiz feedback, before a retry (I-2). */
function withoutReference(verdict: Verdict, answered: Scene | undefined): Verdict {
  const { key_points: _points, key_points_missing: _missing, model_answer: _model, reference_kind: _kind, ...rest } = verdict;
  if (feedbackRevealsCorrectChoice(answered, verdict)) {
    const { feedback: _feedback, ...safe } = rest;
    return safe;
  }
  return rest;
}

/** Passages released together, each once (a scene answered twice cites the same passage twice). */
function uniqueSources(sources: readonly CitedSource[]): CitedSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = JSON.stringify([source.title, source.quote, source.url ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Map a concept's hidden `confidence_calibration` to a learner-facing, NUMBER-FREE verdict. Returns
 * null when the concept has no checkpointed calibration yet (calibration === 0 with no attempts).
 * Never leaks mastery or the raw gap. Exported + pure for reuse across the runtime + a unit test. */
export function calibrationVerdict(cs: ConceptState, locale: "fr" | "en" = "fr"): CalibrationVerdict | null {
  const gap = cs.confidence_calibration;
  // "measured" = a confidence was actually observed. Without a sample, confidence_calibration defaults
  // to 0 (in-band) and a "bien calibrée" verdict would be a FABRICATED reassurance — so gate on the
  // sample count, sharing ONE definition of measured with isCalibrated/isMiscalibrated (learner-state).
  if (cs.total_attempts === 0 || (cs.calibration_samples ?? 0) === 0) return null;
  if (Math.abs(gap) < CALIBRATION_WELL_BAND) {
    return {
      concept_id: cs.concept_id,
      band: "bien",
      message: LessonSession.phrase("calibration_well", {}, locale),
    };
  }
  if (gap > 0) {
    return {
      concept_id: cs.concept_id,
      band: "sur",
      message: LessonSession.phrase("calibration_over", {}, locale),
    };
  }
  return {
    concept_id: cs.concept_id,
    band: "sous",
    message: LessonSession.phrase("calibration_under", {}, locale),
  };
}

export interface SessionHostOptions {
  bundlesRoot: string;
  /** C6: the learner's personal library, searched after `bundlesRoot` on every lookup and listed by
   * listLessons — a lesson written there after the host started is playable at once. */
  libraryRoot?: string;
  /** C6: where durable learner state lives. Absent ⇒ STUDIUM_DATA_DIR (deps.ts); null ⇒ in memory. */
  dataDir?: string | null;
  /** C6: the learner_id used when a caller names none (STUDIUM_LEARNER_ID). Absent ⇒ "anonymous". */
  defaultLearnerId?: string;
  live: boolean;
  /** OPTIONAL per-run judgment regenerator. When present, a spot_the_flaw with regenerate_from_run has its
   * flawed_content/claims regenerated from the learner's OWN run (server-side) when they run the capsule —
   * sound even for a stochastic capsule. Absent ⇒ authored flaws (deterministic). */
  judgmentGenerator?: JudgmentGenerator;
  /** OPTIONAL clock. Stamps every session's history and memory AND is the default "now" of the
   * review/reinforcement reads, so a test with a fixed clock sees a consistent timeline. Absent ⇒
   * wall-clock. A session started with now_ms runs on an OffsetClock anchored there, over this one (L-1). */
  clock?: Clock;
  /** RFR-13: the time zone every date is a day in — the yyyy-mm-dd of the JSON and the date
   * display_markdown prints. An IANA name ("Europe/Paris", "UTC"); absent ⇒ the machine's (TZ). */
  timeZone?: string;
}

export interface SessionResume {
  kind: "new" | "resumed" | "completed";
  scene_id: string;
  scenes_completed: number;
}

/** L-11: the one line a served result carries when the learner's progress could not be saved. */
function persistenceWarning(error: unknown): string {
  return `the learner's progress could not be saved (this session goes on): ${(error as Error).message}`;
}

/** A presentation as the host serves it: the engine's view, who wrote the lesson (with its approval
 * record), and the localized text a chat client shows as is (chat-display.ts). */
export type ServedPresentation = PublicPresentation & { authoring: AuthoringBlock; display_markdown: string };

/** The verdict once served: the text the learner earned by answering, and the passages the scene
 * cites — released only now (SL-5). */
export type ServedVerdict = NonNullable<Transition["verdict"]> & { display_markdown: string; sources?: CitedSource[] };

/** HJ-1: on a completed lesson, when its concepts come back for review. */
export interface ReviewPlan { next_due_at: number | null; next_due_date: string | null; concepts: string[] }

/** A transition as the host serves it. `display_markdown` is the public part — where the lesson goes,
 * then the next scene — and `verdict.display_markdown` what the answer earned; a chat shows the
 * verdict's first. `self_rating` (C4) names the scene to pass to rateRecall. */
type ServedTransitionBase<T extends PublicTransition = PublicTransition> = T extends { presentation: PublicPresentation }
  ? Omit<T, "presentation"> & { presentation: ServedPresentation } : T;
export type ServedTransition = ServedTransitionBase & {
  verdict?: ServedVerdict;
  display_markdown: string;
  self_rating?: SelfRatingRequest & { scene_id: string };
  review_plan?: ReviewPlan;
  /** The host's evidence-based completion groups, shared by chat and graphical clients. */
  completion?: CompletionSplit;
  /** L-11 (CC-6): the answer counts and the session moved on, but the learner's progress could not be
   * saved — why, in one line (display_markdown says so to the learner). */
  persistence_warning?: string;
  /** The learner's concept map, at the moments it is worth showing (ConceptMap.moment); absent otherwise. */
  concept_map?: ConceptMap;
};

export interface SessionStartResult {
  sessionId: string;
  presentation: ServedPresentation;
  /** The lesson's concept map as the session opens; absent for a lesson with fewer than two concepts. */
  concept_map?: ConceptMap;
  resume: SessionResume;
  /** Who wrote the lesson (also on `presentation.authoring`). */
  authoring: AuthoringBlock;
  /** C6: whether this progress survives a restart, and where it lives. */
  persistence: PersistenceInfo;
  due?: RoutedReinforcementTarget[];
}

export interface SessionStartOptions {
  nowMs?: number;
  presentationLanguage?: string;
}

/** C4: what a self-rating changed — the rated concepts' next review. Never their mastery. */
export interface RecallRating {
  scene_id: string;
  /** The rated scene's first concept (concept_ids[0]), kept for consumers that schedule one concept. */
  concept_id: string;
  /** L-9: every concept the rating scheduled — the rated scene's concept_refs. */
  concept_ids: string[];
  grade: SelfRating;
  source: "self_rated";
  /** The earliest next review of the rated concepts. */
  next_review_at: number;
  next_review_date: string;
  /** UX-11: the updated plan for this lesson's concepts only. */
  review_plan?: ReviewPlan;
  /** L-11: the rating counts in this session but could not be saved (why, in one line). */
  persistence_warning?: string;
  display_markdown: string;
}

/** One lesson as list_lessons shows it (HJ-5). */
export interface ListedLesson {
  bundle_ref: string;
  title: string;
  language: string;
  discipline: string;
  /** Where it was found: the configured bundles root, or the learner's library. */
  source: CatalogLesson["root"];
  authoring: CatalogLesson["authoring"];
  validated: boolean;
  concepts: string[];
  scene_count: number;
  /** With a learner: how far they got. */
  status?: { state: "new" | "in_progress" | "completed"; scenes_completed: number; total_scenes: number };
}

export interface LessonListing {
  lessons: ListedLesson[];
  courses: Array<{ course_ref: string; course_id: string; title: string; lessons: Array<{ lesson_id: string; bundle_ref: string }> }>;
  /** Files named like a lesson that do not load. */
  skipped: number;
  /** L-4: the list as a chat shows it, in the language asked for, else the learner's. */
  display_markdown: string;
}

/** What export_concept_map returns: the record, and where it was written (null without a library). */
export interface ConceptMapExport {
  record: ConceptMapRecord;
  saved_to: string | null;
  sha256: string | null;
  display_markdown: string;
}

/** Folder of the learner's library that holds exports of their sessions (forget reports it as kept). */
const EXPORTS_DIR = "_exports";

/** L-13: one thing forget_session erased or kept. `lessons` names lessons by title; `path` is a
 * folder or file left on disk. */
export interface ForgetItem {
  kind: "lesson_progress" | "learner_profile" | "study_record" | "other_lessons_progress" | "library_lessons"
    | "lesson_sources" | "map_exports" | "pseudonym_key";
  lessons?: string[];
  path?: string;
}

/** L-13: what forget_session did — scope `lesson` (forget(session)) or `learner` (forgetLearner) —
 * and what stays, with the text to show. The install's pseudonym key is reported in `kept` (it holds
 * no learner data) and never named in display_markdown. */
export interface ForgetReport {
  forgotten: true;
  scope: "lesson" | "learner";
  erased: ForgetItem[];
  kept: ForgetItem[];
  display_markdown: string;
}

export interface ReviewItem { concept_id: string; concept: string; lesson_title: string; scene_id: string; bundle_ref: string }

/** start_review_session (HJ-1, SL-2): a session of the due retrieval scenes, or why there is none. */
export type ReviewStartResult =
  | ({ status: "started"; review: { items: ReviewItem[]; not_playable?: string[] } } & SessionStartResult)
  | {
    status: "nothing_due"; next_review_at: number | null; next_review_date: string | null; display_markdown: string;
    /** Concepts due that no lesson on disk can review any more (their lesson is gone). */
    not_playable?: string[];
  };

export class PeerRoomError extends Error {
  constructor(msg: string) { super(msg); this.name = "PeerRoomError"; }
}

const REVIEW_TITLE: Readonly<Record<DisplayLocale, string>> = { fr: "Séance de révision", en: "Review session" };

/** Multi-session host shared by the HTTP and MCP drivers. */
export class SessionHost {
  private readonly registry = new SessionRegistry();
  private readonly experiments = new Map<string, ExperimentJournal>();
  // D1 PeerStudio: ephemeral rooms indexed by id and by join_code.
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly joinCodeIndex = new Map<string, string>(); // join_code → room_id
  /** C6: durable learner data, or null when everything stays in this process. */
  private readonly dataDir: string | null;
  // CROSS-LESSON learner profile (warm-start across bundles) and study record (where each concept was
  // learned, how far each lesson got). File-backed in durable mode, else in memory for this host.
  private readonly profileStore: LearnerProfileStore;
  private readonly studyStore: StudyRecordStore;
  /** The last write-through queued per learner: two sessions of one learner write one after the other,
   * so neither saves over the other's update (each write is a load, a merge and a save). */
  private readonly learnerWrites = new Map<string, Promise<void>>();
  /** INT-STUDIUM-058: the session that last wrote each learner's status file from this host
   * (publishStatus): only that session takes the file away when it closes. */
  private readonly statusWriters = new Map<string, SessionEntry>();
  /** RFR-13: the time zone of every date this host names (calendar.ts). */
  private readonly zone: string;
  /** L-11: learners forgotten in this host, by profile pseudonym, with when (this host's sequence of
   * opens and forgets): a session of theirs opened before that never writes them back. */
  private readonly forgotten = new Map<string, number>();
  /** L-11: one step per session opened and per learner forgotten, so « opened before the forget » never
   * depends on two events falling in distinct milliseconds of the wall clock. */
  private sequence = 0;
  /** L-11: sessions closed because their learner's data was erased: a later call says so, and points
   * to a fresh start, rather than to a restart of the server. */
  private readonly erasedIds = new Set<string>();
  constructor(private readonly opts: SessionHostOptions) {
    this.zone = checkTimeZone(opts.timeZone ?? localTimeZone());
    this.dataDir = opts.dataDir !== undefined ? opts.dataDir : durableDataDir();
    this.profileStore = this.dataDir ? new FileLearnerProfileStore(this.dataDir) : new InMemoryLearnerProfileStore();
    this.studyStore = this.dataDir ? new FileStudyRecordStore(this.dataDir) : new InMemoryStudyRecordStore();
    // L-11 (SEC-8): the data folder holds learners' answers and progress — this user's alone.
    if (this.dataDir) tightenFolder(this.dataDir);
  }

  /** The root a bundle_ref is looked up in first. */
  get bundlesRoot(): string { return this.opts.bundlesRoot; }
  /** C6, L-12: the learner's library — where authored lessons and their sources go — or null. */
  get libraryRoot(): string | null { return this.opts.libraryRoot ?? null; }
  /** RFR-13: the IANA time zone every date of this host is a day in (get_server_info reports it). */
  get timeZone(): string { return this.zone; }
  /** C6: the learner_id used when a caller names none. */
  get defaultLearnerId(): string { return this.opts.defaultLearnerId ?? DEFAULT_LEARNER_ID; }
  /** Whether a judge model grades production scenes here (the authoring notices depend on it). */
  get judge(): boolean { return this.opts.live; }

  /** C6: whether progress survives a restart, where lessons and state live, the default learner. */
  persistence(): PersistenceInfo {
    return persistenceInfo({
      dataDir: this.dataDir, libraryRoot: this.opts.libraryRoot ?? null, learnerIdDefault: this.defaultLearnerId,
    });
  }

  /** The roots a bundle_ref is looked up in, in order: the bundles root, then the library. */
  private roots(): string[] {
    const library = this.opts.libraryRoot;
    return library && resolve(library) !== resolve(this.opts.bundlesRoot) ? [this.opts.bundlesRoot, library] : [this.opts.bundlesRoot];
  }

  /** The lesson roots listed, the bundles root being the library itself when they coincide. */
  private lessonRoots(): LessonRoot[] {
    const library = this.opts.libraryRoot;
    if (library && resolve(library) === resolve(this.opts.bundlesRoot)) return [{ kind: "library", dir: library }];
    return [{ kind: "bundles", dir: this.opts.bundlesRoot }, ...(library ? [{ kind: "library" as const, dir: library }] : [])];
  }

  /** Every lesson and course on disk now: read fresh, so a lesson written after start is listed. */
  private catalog(): Promise<Catalog> {
    return scanCatalog(this.lessonRoots(), { exclude: this.dataDir ? [this.dataDir] : [] });
  }

  /** I-6: the data folder's own pseudonym secret, read (or created) the first time a durable host
   * needs one while STUDIUM_PSEUDO_SECRET is unset (or blank, L-11); none in ephemeral mode. */
  private installSecretValue: string | undefined;
  private installSource: InstallSecret["source"] | undefined;
  /** L-11: STUDIUM_PSEUDO_SECRET was recorded as what keys this data folder (pseudonym-secret.ts). */
  private envKeyRecorded = false;
  private pseudoSecret(): string | undefined {
    if (this.dataDir === null) return undefined;
    if (envPseudoSecret() !== undefined) {
      if (!this.envKeyRecorded) { markEnvKeyed(this.dataDir); this.envKeyRecorded = true; }
      return undefined;
    }
    // L-11 (SEC-4 host side): a data folder erased under this server — its marker, or its secret file,
    // is gone — is keyed afresh: the secret kept in memory would write learners no later server can
    // read, and folders left without a secret would make the next one fall back to the legacy secret.
    if (this.installSecretValue !== undefined && !this.keyFilesIntact()) {
      this.installSecretValue = undefined;
      this.installSource = undefined;
    }
    if (this.installSecretValue === undefined) {
      const found = installSecret(this.dataDir);
      this.installSecretValue = found.secret;
      this.installSource = found.source;
    }
    return this.installSecretValue;
  }

  /** The data folder still holds what keys this host's learners: its marker and, for a per-install
   * secret, that very secret (a legacy folder has none, and none may have appeared since). */
  private keyFilesIntact(): boolean {
    if (this.dataDir === null) return true;
    if (!existsSync(join(this.dataDir, KEY_SOURCE_FILE))) return false;
    const current = currentInstallSecret(this.dataDir);
    return this.installSource === "legacy" ? current === null : current === this.installSecretValue;
  }

  /** A session's ports, keyed by this host's pseudonym secret (buildHostDeps), on `clock` when given
   * (a session started with now_ms, L-1), else on the host's. */
  private deps(scopeDir?: string, clock?: Clock) {
    return buildHostDeps(this.opts.live, scopeDir, clock ?? this.opts.clock, this.pseudoSecret());
  }

  /** L-1: the clock of a session started with `nowMs` — anchored there, moving with the host's clock —
   * or undefined (the host's clock). */
  private sessionClock(nowMs: number | undefined): Clock | undefined {
    return nowMs === undefined ? undefined : new OffsetClock(nowMs, this.opts.clock);
  }

  /** The learner-level pseudonym keying the profile and the study record (RGPD: never the raw id). */
  private profilePseudonymOf(learnerId: string): Promise<string> {
    return this.deps().pseudonym.get(learnerId, PROFILE_PSEUDONYM_SCOPE);
  }

  /** Start or resume a lesson; legacy third-argument clocks and languages remain supported. */
  async create(bundleRef: string, learnerId: string = this.defaultLearnerId, options?: SessionStartOptions | number | string): Promise<SessionStartResult> {
    const { nowMs: requestedNow, presentationLanguage } = typeof options === "number" ? { nowMs: options }
      : typeof options === "string" ? { presentationLanguage: options } : options ?? {};
    // L-1: a session started with now_ms stamps its answers, ratings and memory on a clock anchored there.
    const nowMs = requestedNow === undefined ? undefined : checkNowMs(requestedNow);
    const clock = this.sessionClock(nowMs);
    const normalizedPresentationLanguage = presentationLanguage === undefined
      ? undefined
      : normalizePresentationLanguage(presentationLanguage);
    const profilePseudonym = await this.profilePseudonymOf(learnerId);
    return this.learnerOperation(profilePseudonym, async () => {
      const resolved = await loadResolvedBundle(this.roots(), bundleRef, shuffleSaltFor(learnerId));
      const bundle = resolved.bundle;
      // C5: an approval record next to a course's lesson.json, bound to the very bytes just loaded.
      const approval = await readApproval(resolved.sha256 ? dirname(resolved.path) : null, resolved.sha256);
      const authoring = authoringOf(bundle, { judge: this.opts.live, approval });
      // #3 DURABLE mode: scope the File* stores under a per-learner dir keyed by the RGPD-safe pseudonym
      // (never the raw learnerId). We derive the pseudonym with the SAME provider+secret+bundle_id the
      // session uses in start() (session.ts), guaranteeing the host dir pseudonym === session pseudonym.
      let deps;
      let journalDirectory: string | undefined;
      let scopeDir: string | undefined;
      let prior: LearnerState | null = null;
      if (this.dataDir) {
        // Build deps once to obtain the (fail-closed) pseudonym provider, derive the scope dir, then
        // rebuild the deps with File* stores rooted at that dir. resolvePseudoSecret runs in
        // buildHostDeps, so a misconfigured prod still throws BEFORE any dir is touched.
        const probe = this.deps();
        const pseudonym = await probe.pseudonym.get(learnerId, bundle.bundle_id);
        scopeDir = durableScopeDir(this.dataDir, pseudonym, bundle.bundle_id);
        // Shared default identities must not carry raw learner text into another session.
        if (learnerId.trim() && learnerId !== "anonymous" && learnerId !== "agent-operator")
          journalDirectory = join(scopeDir, "experiments");
        deps = this.deps(scopeDir, clock);
        // #3 RESUME: load any prior LearnerState for this (pseudonym, bundle_id). FileStateStore.load
        // returns null on missing/parse-error, so a fresh learner falls back to defaultLearnerState.
        prior = await deps.stateStore.load(bundle.bundle_id);
      } else {
        deps = this.deps(undefined, clock);
      }
      // CROSS-LESSON warm-start: seed the working state from the learner-level profile, so a concept
      // mastered in ANOTHER lesson resumes warm here — its mastery (seedConceptStatesFromProfile never
      // overwrites the per-bundle prior) and its FSRS memory (startingMemory).
      const profile = await this.profileStore.load(profilePseudonym);
      const conceptIds = bundle.concepts.map((c) => c.id);
      let initial = prior ?? defaultLearnerState(bundle.bundle_id);
      if (profile) initial = seedConceptStatesFromProfile(initial, profile, conceptIds);
      initial = { ...initial, concept_memory: startingMemory(prior, profile, conceptIds) };
      const completed = isLessonCompleted(bundle, initial, profile);
      const session = new LessonSession(bundle, deps, initial, learnerId, completed);
      const entry = this.newEntry({
        session, deps, bundle, bundleRef, baseDir: resolved.baseDir, profilePseudonym, authoring, kind: "lesson",
        memory: initial.concept_memory ?? {}, profileSeen: profile !== null, lessonSha256: resolved.sha256 ?? null,
        ...(normalizedPresentationLanguage ? { presentationLanguage: normalizedPresentationLanguage } : {}),
        ...(scopeDir ? { scopeDir } : {}),
        ...(resolved.minutesPerDay !== null ? { minutesPerDay: resolved.minutesPerDay } : {}),
      });
      const started = await session.start();
      const sessionId = randomUUID();
      this.registry.create(sessionId, entry);
      this.experiments.set(sessionId, new ExperimentJournal(experimentRevision(bundle), journalDirectory));
      const presentation = this.served(entry, started);
      await this.publishStatus(entry);
      const resume = resumeFor(bundle, initial, profile, presentation.scene.id);
      const record = resume.kind === "completed" ? await this.studyStore.load(profilePseudonym) : null;
      const conceptMap = this.conceptMapOf(entry, "start");
      return {
        sessionId,
        presentation,
        ...(conceptMap ? { concept_map: conceptMap } : {}),
        resume,
        authoring,
        persistence: this.persistence(),
        ...(resume.kind === "completed" ? { due: routedProfileDue(profile, bundle, nowMs ?? this.nowMs(), record) } : {}),
      };
    });
  }

  /** A registry entry with the per-session bookkeeping the host keeps beside the engine. */
  private newEntry(
    fields: Omit<SessionEntry,
      "assetCache" | "engineMemory" | "selfRated" | "moved" | "responses" | "conceptStatesAtStart" | "withheldSources"
      | "openedAt" | "keyedBy" | "erased" | "learnerTombstone">,
  ): SessionEntry {
    const states = fields.session.getState().concept_states; // before start(): the initial state
    // L-11: the secret this session's folders are keyed by, when it is the data folder's own.
    const keyedBy = this.dataDir !== null && envPseudoSecret() === undefined ? this.installSecretValue : undefined;
    return {
      ...fields,
      memory: structuredClone(fields.memory),
      engineMemory: structuredClone(fields.memory),
      assetCache: new Map(), selfRated: new Set(), moved: new Set(), responses: 0, withheldSources: [],
      conceptStatesAtStart: Object.fromEntries(Object.entries(states).map(([id, cs]) => [id, JSON.stringify(cs)])),
      openedAt: ++this.sequence,
      learnerTombstone: fields.profilePseudonym ? this.learnerTombstone(fields.profilePseudonym) : null,
      ...(keyedBy !== undefined ? { keyedBy } : {}),
    };
  }

  /** start_review_session (HJ-1, SL-2): one session of a retrieval scene per concept due — mastered
   * concepts whose recall is due, then reviewed ones still weak, then self-rated ones (I-3) — taken
   * from the lessons they were learned in, across lessons. Graded like any lesson; its answers move
   * the concepts' memory and mastery, nothing else is kept (no lesson state on disk, never a
   * completed lesson).
   *
   * L-8 (H2, CC-4): the concepts no lesson on disk can review are set aside BEFORE max_items is taken,
   * with the same scene choice the study plan uses (pickReviewScene), and named in not_playable. L-1:
   * with nowMs the session runs on a clock anchored there. L-4: `language` (fr|en) is the review's
   * language; by default the learner's last lesson's, else the first lesson reviewed's. */
  async startReview(
    learnerId: string = this.defaultLearnerId,
    opts: { maxItems?: number; nowMs?: number; presentationLanguage?: string; language?: DisplayLocale } = {},
  ): Promise<ReviewStartResult> {
    const nowMs = this.nowOr(opts.nowMs);
    const requestedLanguage = opts.language === undefined ? undefined : checkLocale(opts.language);
    const deps = this.deps(undefined, this.sessionClock(opts.nowMs));
    const profilePseudonym = await deps.pseudonym.get(learnerId, PROFILE_PSEUDONYM_SCOPE);
    return this.learnerOperation(profilePseudonym, async () => {
      const [profile, record] = await Promise.all([this.profileStore.load(profilePseudonym), this.studyStore.load(profilePseudonym)]);
      const memory = profile?.concept_memory ?? {};
      const schedule = scheduleFromMemory(memory, masteryFromProfile(profile), nowMs, measuredOf(profile?.concept_states));
      const limit = Math.max(1, Math.min(MAX_REVIEW_ITEMS, Math.trunc(opts.maxItems ?? DEFAULT_REVIEW_ITEMS)));
      const wanted = [...schedule.due, ...schedule.relearn, ...schedule.unmeasured].map((w) => w.concept_id);
      const reviewSalt = JSON.stringify([learnerId, "review", calendarDate(nowMs, this.zone)]);
      const sources = await this.reviewSources(wanted, record, reviewSalt);
      const playable = sources.filter((s) => this.reviewSceneOf(s) !== null);
      const taken = playable.slice(0, limit);
      const reviewLanguage = requestedLanguage ?? this.recordLanguage(record) ?? taken[0]?.bundle.metadata.language
        ?? sources[0]?.bundle.metadata.language ?? DEFAULT_LOCALE;
      const locale = displayLocale(reviewLanguage);
      const built = buildReviewBundle(taken, {
        title: REVIEW_TITLE[locale], nowIso: new Date(nowMs).toISOString(), judge: this.opts.live, language: reviewLanguage,
      });
      // A due concept no review scene grades stays due: say which, so a harness can explain why.
      const playableIds = new Set(playable.map((s) => s.conceptId));
      const notPlayable = wanted.filter((id) => !playableIds.has(id));
      const unplayable = notPlayable.length ? { not_playable: notPlayable } : {};
      if (!built) {
        const titleOf = (conceptId: string) =>
          sources.flatMap((s) => s.bundle.concepts).find((c) => c.id === conceptId)?.title ?? conceptId;
        return {
          status: "nothing_due",
          next_review_at: schedule.next_due_at === null ? null : Math.round(schedule.next_due_at),
          next_review_date: schedule.next_due_at === null ? null : calendarDate(schedule.next_due_at, this.zone),
          display_markdown: nothingToReviewMarkdown(schedule.next_due_at, locale, this.zone, notPlayable.map(titleOf)),
          ...unplayable,
        };
      }
      const bundle = built.bundle;
      const conceptIds = bundle.concepts.map((c) => c.id);
      let initial = defaultLearnerState(REVIEW_BUNDLE_ID);
      if (profile) initial = seedConceptStatesFromProfile(initial, profile, conceptIds);
      initial = { ...initial, concept_memory: pick(memory, new Set(conceptIds)) };
      const session = new LessonSession(bundle, deps, initial, learnerId, false);
      const authoring = authoringOf(bundle, { judge: this.opts.live });
      const language = opts.presentationLanguage === undefined ? undefined : normalizePresentationLanguage(opts.presentationLanguage);
      const entry = this.newEntry({
        session, deps, bundle, bundleRef: REVIEW_BUNDLE_ID, baseDir: "", profilePseudonym, authoring, kind: "review",
        reviewOrigins: built.origins, memory: initial.concept_memory ?? {}, profileSeen: profile !== null,
        ...(language ? { presentationLanguage: language } : {}),
      });
      const started = await session.start();
      const sessionId = randomUUID();
      this.registry.create(sessionId, entry);
      this.experiments.set(sessionId, new ExperimentJournal(experimentRevision(bundle), undefined));
      const presentation = this.served(entry, started);
      await this.publishStatus(entry);
      const items = bundle.scenes.map((scene): ReviewItem => {
        const origin = built.origins[scene.id]!;
        const conceptId = scene.concept_refs[0] ?? "";
        return {
          concept_id: conceptId,
          concept: bundle.concepts.find((c) => c.id === conceptId)?.title ?? conceptId,
          lesson_title: origin.lesson_title,
          scene_id: scene.id,
          bundle_ref: origin.bundle_ref,
        };
      });
      return {
        status: "started", sessionId, presentation, authoring, persistence: this.persistence(),
        resume: { kind: "new", scene_id: presentation.scene.id, scenes_completed: 0 },
        review: { items, ...unplayable },
      };
    });
  }

  /** The scene a review plays for `source`, or null (review-session.ts pickReviewScene). The study plan
   * and the review session decide playability with this one function (L-8). */
  private reviewSceneOf(source: ReviewSource): Scene | null {
    return pickReviewScene(source.bundle, source.conceptId, source.lastSceneId, { judge: this.opts.live });
  }

  /** For each concept, the lesson it is reviewed from: the one the study record says it was last
   * graded in, while that lesson loads and still has a scene to review it with; else a lesson on disk
   * that teaches it, one with such a scene first. A concept no lesson on disk teaches has no source;
   * one whose lessons have no such scene keeps a source the review cannot play. */
  private async reviewSources(conceptIds: readonly string[], record: StudyRecord | null, shuffleSalt: string): Promise<ReviewSource[]> {
    const loaded = new Map<string, Promise<{ bundle: LessonBundle; baseDir: string } | null>>();
    const load = (ref: string) => {
      if (!loaded.has(ref)) {
        loaded.set(ref, loadResolvedBundle(this.roots(), ref, shuffleSalt).then((r) => ({ bundle: r.bundle, baseDir: r.baseDir }), () => null));
      }
      return loaded.get(ref)!;
    };
    let catalog: Catalog | null = null;
    const sources: ReviewSource[] = [];
    for (const conceptId of conceptIds) {
      const route = record?.concepts[conceptId];
      const routed = route ? await load(route.bundle_ref) : null;
      const found: ReviewSource[] = routed && route
        ? [{ conceptId, bundleRef: route.bundle_ref, bundle: routed.bundle, baseDir: routed.baseDir, lastSceneId: route.scene_id }]
        : [];
      if (!found.some((source) => this.reviewSceneOf(source))) {
        // Never routed, its lesson is gone, or it no longer reviews the concept: a lesson on disk that does.
        catalog ??= await this.catalog();
        for (const listed of catalog.lessons) {
          if (listed.bundle_ref === route?.bundle_ref || !listed.concepts.some((c) => c.id === conceptId)) continue;
          const lesson = await load(listed.bundle_ref);
          if (!lesson) continue;
          const source = { conceptId, bundleRef: listed.bundle_ref, bundle: lesson.bundle, baseDir: lesson.baseDir, lastSceneId: null };
          if (this.reviewSceneOf(source)) { found.unshift(source); break; }
          found.push(source);
        }
      }
      if (found[0]) sources.push(found[0]);
    }
    return sources;
  }

  /** The language of the lesson the learner touched last, from their study record. */
  private recordLanguage(record: StudyRecord | null): string | undefined {
    return Object.values(record?.lessons ?? {}).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.language;
  }

  /** COURSE SPINE: the next lesson the learner should take in `course` — the first not-completed lesson
   * whose prerequisites are all completed — or null when the course is finished / nothing is unlocked.
   * Reads the learner's completed_lessons from the cross-lesson profile (the same learner-level pseudonym
   * the profile is keyed by). The caller then host.create(next.bundle_ref, learnerId) to start it. */
  async nextLesson(course: Course, learnerId: string = this.defaultLearnerId): Promise<CourseLesson | null> {
    const profile = await this.profileStore.load(await this.profilePseudonymOf(learnerId));
    return nextCourseLesson(course, profile?.completed_lessons ?? []);
  }

  /** CROSS-LESSON spaced-repetition router (no live session needed): the concepts the learner is DUE to
   * reinforce now, most-urgent first, from the PERSISTED `concept_memory` in their profile + mastery
   * from the profile's concept_states. Empty when no profile / no memory. `nowMs` injected for
   * deterministic review scheduling. */
  async dueReinforcements(learnerId: string = this.defaultLearnerId, nowMs?: number): Promise<ReinforcementTarget[]> {
    const at = this.nowOr(nowMs);
    return this.dueReinforcementsForProfile(await this.profilePseudonymOf(learnerId), at);
  }

  /** Profile-keyed variant used by live sessions without retaining the raw learner id. */
  async dueReinforcementsForProfile(profilePseudonym: string, nowMs?: number): Promise<ReinforcementTarget[]> {
    const at = this.nowOr(nowMs);
    const profile = await this.profileStore.load(profilePseudonym);
    if (!profile?.concept_memory) return [];
    return dueReinforcementTargetsFromMemory(profile.concept_memory, masteryFromProfile(profile), at);
  }

  /** Profile-only reinforcement status for a learner who has no live session. Each target names the
   * lesson and scene the concept was last graded in (HJ-1). */
  async reinforcementStatusForLearner(
    learnerId: string = this.defaultLearnerId,
    requestedNow?: number,
  ): Promise<ReinforcementStatus> {
    const nowMs = this.nowOr(requestedNow);
    const pseudonym = await this.profilePseudonymOf(learnerId);
    const [profile, record] = await Promise.all([this.profileStore.load(pseudonym), this.studyStore.load(pseudonym)]);
    const status = statusOf(profile?.concept_memory ?? {}, masteryFromProfile(profile), measuredOf(profile?.concept_states),
      nowMs, "profile", null, record);
    const { ranked, ...rest } = status;
    return { ...rest, due: ranked.map(({ source, target }) => routedTarget(null, source, target, record)) };
  }

  /** The learner's NEXT course step, AUTO-ROUTED by FSRS: a DUE reinforcement (a concept mastered in an
   * earlier lesson whose recall has decayed) PREEMPTS advancing to new material — so spaced repetition
   * actually drives the course, not just a readout a driver may ignore. When nothing is due, advance the
   * course spine (next not-done lesson whose prereqs are met). When no lesson is left to advance, the
   * course is either `done` (every lesson completed) or `blocked` (lessons remain but none is unlocked —
   * a mis-authored unmet/cyclic prereq) — disambiguated via isCourseComplete. A still-due concept keeps
   * surfacing `reinforce` even past the last lesson (review never stops). Loads the profile ONCE.
   * `nowMs` injected for deterministic scheduling. */
  async nextCourseStep(course: Course, learnerId: string = this.defaultLearnerId, requestedNow?: number): Promise<CourseStep> {
    const nowMs = this.nowOr(requestedNow);
    const profile = await this.profileStore.load(await this.profilePseudonymOf(learnerId));
    if (profile?.concept_memory) {
      const top = dueReinforcementTargetsFromMemory(profile.concept_memory, masteryFromProfile(profile), nowMs)[0];
      if (top) return { kind: "reinforce", concept_id: top.concept_id, due_at: top.due_at, retrievability: top.retrievability };
    }
    const completed = profile?.completed_lessons ?? [];
    const next = nextCourseLesson(course, completed);
    if (next) return { kind: "advance", lesson: next };
    // nextCourseLesson returns null for BOTH "all done" and "stuck (nothing unlocked)" — disambiguate.
    return isCourseComplete(course, completed) ? { kind: "done" } : { kind: "blocked" };
  }

  /** get_study_plan (HJ-5, R2): what to do now — reviews due (dated), concepts to relearn, lessons in
   * progress, the next lesson — and one sentence saying which. L-4: `language` (fr|en; `locale` is its
   * older name) defaults to the language of the lesson the learner touched last, else of the newest
   * lesson on disk, else English. RFR-06: the learner's minutes a day size the next step. */
  async studyPlan(
    learnerId: string = this.defaultLearnerId, opts: { nowMs?: number; locale?: DisplayLocale; language?: DisplayLocale } = {},
  ): Promise<StudyPlan> {
    const nowMs = this.nowOr(opts.nowMs);
    const requested = opts.language ?? opts.locale;
    const language = requested === undefined ? undefined : checkLocale(requested);
    const pseudonym = await this.profilePseudonymOf(learnerId);
    const [profile, stored, catalog] = await Promise.all([
      this.profileStore.load(pseudonym), this.studyStore.load(pseudonym), this.catalog(),
    ]);
    const record = stored ?? emptyStudyRecord();
    const newestLesson = [...catalog.lessons].sort((a, b) => b.modified_at - a.modified_at)[0];
    const memory = profile?.concept_memory ?? {};
    const mastery = masteryFromProfile(profile);
    const measured = measuredOf(profile?.concept_states);
    // Playability is decided exactly as startReview decides it, so the plan never points at a review
    // that would answer « nothing to review » (R2, L-8).
    const schedule = scheduleFromMemory(memory, mastery, nowMs, measured);
    const sources = await this.reviewSources(
      [...schedule.due, ...schedule.relearn, ...schedule.unmeasured].map((s) => s.concept_id), record, shuffleSaltFor(learnerId));
    const reviewSeconds = new Map<string, number>();
    const reviewFrom = new Map<string, { bundle_ref: string; title: string; scene_id: string }>();
    for (const source of sources) {
      const scene = this.reviewSceneOf(source);
      if (!scene) continue;
      reviewSeconds.set(source.conceptId, scene.estimated_seconds);
      reviewFrom.set(source.conceptId, { bundle_ref: source.bundleRef, title: source.bundle.metadata.title, scene_id: scene.id });
    }
    return buildStudyPlan({
      nowMs,
      memory,
      mastery,
      record,
      completedLessons: profile?.completed_lessons ?? [],
      catalog,
      locale: language ?? displayLocale(this.recordLanguage(record) ?? newestLesson?.language ?? DEFAULT_LOCALE),
      learnerId,
      playableReviews: new Set(reviewSeconds.keys()),
      reviewFrom,
      measured,
      timeZone: this.zone,
      reviewSeconds,
    });
  }

  /** list_lessons (HJ-5): the lessons on disk now, in the bundles root and the learner's library, with
   * the learner's progress when `learnerId` is given. `query` keeps lessons whose title, ref,
   * discipline or concepts contain every word of it (case and accents ignored). L-4: display_markdown
   * speaks `language` (fr|en), else the language of the learner's last lesson, else of the newest
   * lesson on disk, else English. */
  async listLessons(opts: { query?: string; learnerId?: string; language?: DisplayLocale } = {}): Promise<LessonListing> {
    const language = opts.language === undefined ? undefined : checkLocale(opts.language);
    const catalog = await this.catalog();
    const words = foldText(opts.query ?? "").split(/\s+/).filter(Boolean);
    const haystack = (l: CatalogLesson) => foldText([l.title, l.bundle_ref, l.discipline, ...l.concepts.map((c) => c.title)].join(" "));
    const lessons = catalog.lessons.filter((l) => words.every((w) => haystack(l).includes(w)));
    let progress: ((l: CatalogLesson) => NonNullable<ListedLesson["status"]>) | null = null;
    let learnerLanguage: string | undefined;
    if (opts.learnerId !== undefined) {
      const pseudonym = await this.profilePseudonymOf(opts.learnerId);
      const [profile, record] = await Promise.all([this.profileStore.load(pseudonym), this.studyStore.load(pseudonym)]);
      learnerLanguage = this.recordLanguage(record);
      progress = (l) => {
        const seen = record?.lessons[l.bundle_id];
        const done = profile?.completed_lessons?.includes(l.bundle_id) || seen?.completed === true;
        return {
          state: done ? "completed" : seen && seen.scenes_completed > 0 ? "in_progress" : "new",
          scenes_completed: done ? l.scene_count : seen?.scenes_completed ?? 0,
          total_scenes: l.scene_count,
        };
      };
    }
    const listed: ListedLesson[] = lessons.map((l) => ({
      bundle_ref: l.bundle_ref, title: l.title, language: l.language, discipline: l.discipline, source: l.root,
      authoring: l.authoring, validated: l.validated, concepts: l.concepts.map((c) => c.title), scene_count: l.scene_count,
      ...(progress ? { status: progress(l) } : {}),
    }));
    const newestLesson = [...catalog.lessons].sort((a, b) => b.modified_at - a.modified_at)[0];
    const locale = language ?? displayLocale(learnerLanguage ?? newestLesson?.language ?? DEFAULT_LOCALE);
    return {
      lessons: listed,
      courses: catalog.courses.map(({ course_ref, course }) => ({
        course_ref, course_id: course.course_id, title: course.title,
        lessons: course.lessons.map((cl) => ({ lesson_id: cl.lesson_id, bundle_ref: cl.bundle_ref })),
      })),
      skipped: catalog.skipped,
      display_markdown: lessonListMarkdown(listed.map((l) => ({
        title: l.title, scene_count: l.scene_count, drafted_by: l.authoring.drafted_by, ...(l.status ? { status: l.status } : {}),
      })), locale, opts.query),
    };
  }

  /** Discover the community (learner-authored, approved) bundles under this host's bundles root:
   * with `courseId`, those of `<courseId>/community/`; without, the legacy root-level `community/`
   * (course_id null) plus every course directory's. Each `bundle_ref` loads through `create()`
   * exactly like a canonical bundle, which is never mutated. Throws on an invalid course id. */
  async listCommunityBundles(courseId?: string): Promise<CommunityBundleEntry[]> {
    return discoverCommunityBundleEntries(this.opts.bundlesRoot, courseId);
  }

  private require(id: string): SessionEntry {
    const e = this.registry.get(id);
    if (!e) throw new SessionHostNotFoundError(id, this.erasedIds.has(id) ? "erased" : "unknown");
    return e;
  }

  /** A presentation as served: the authoring block and its chat text. The first screen of a session —
   * before any answer — carries the authoring notice, and a warning when nothing is durable. Every
   * screen carries its `lines`: the voice where it is due, the status line. */
  private served(
    entry: SessionEntry, presentation: Presentation, lines: ScreenLines = this.screenLines(entry, presentation),
  ): ServedPresentation {
    const withAuthoring = {
      ...presentation, authoring: entry.authoring,
      learnerSnapshot: { ...presentation.learnerSnapshot, conceptMastery: this.publicMastery(entry) },
    };
    const firstScreen = entry.responses === 0;
    const plan = firstScreen ? this.conceptMapOf(entry, "start")?.display_markdown : undefined;
    return {
      ...withAuthoring,
      display_markdown: presentationMarkdown(withAuthoring, {
        firstScreen, notDurable: this.dataDir === null, review: entry.kind === "review",
        ...(plan ? { conceptMap: plan } : {}), ...lines,
      }),
    };
  }

  /** INT-STUDIUM-058: what the conversation text of the session's current screen says about itself.
   * The status line, always. The lesson's voice on the first screen, unless a notice there already
   * says who wrote the lesson or that it changed since its approval; on every later screen while the
   * lesson was drafted by an AI and no teacher read this version. A review has no such line: it mixes
   * lessons, and one line would speak for items it does not describe. */
  private screenLines(entry: SessionEntry, presentation: Presentation): ScreenLines {
    const locale: DisplayLocale = presentation.locale === "en" ? "en" : "fr";
    const voice = this.authorVoiceOf(entry);
    const noticed = !!entry.authoring.notice || (entry.authoring.approval.recorded && !entry.authoring.approval.matches);
    const unreviewedAi = voice.kind === "author" && !voice.reviewed && voice.drafted_by === "agent";
    const voiced = entry.kind !== "review" && (entry.responses === 0 ? !noticed : unreviewedAi);
    return {
      statusLine: statusLine(orientationFrom(this.orientationFactsOf(entry)), entry.bundle.metadata.title, locale),
      ...(voiced ? { voiceLine: voiceLine(voice, locale) } : {}),
    };
  }

  /** The learner's concept map now (concept-map.ts), drawn from what the session served and how it
   * was answered. null for a review session and for a lesson with fewer than two concepts. */
  conceptMap(id: string, moment: ConceptMapMoment = "on_request"): ConceptMap | null {
    return this.conceptMapOf(this.require(id), moment);
  }

  /** The exportable record behind the concept map (concept-map-record.ts): the map, the steps with who
   * assessed each answer and how the session routed, and what each scene rests on. No learner
   * identifier, none of the learner's words. null when the session has no map. */
  conceptMapRecord(id: string): ConceptMapRecord | null {
    const entry = this.require(id);
    const map = this.conceptMapOf(entry, "on_request");
    if (!map) return null;
    return buildConceptMapRecord({
      bundle: entry.bundle, map, path: entry.session.learnerPath(), authoring: entry.authoring,
      currentSceneId: entry.completed ? null : entry.session.currentPresentation().scene.id,
      withheldSceneIds: new Set(entry.withheldSources.map((held) => held.sceneId)),
      completed: entry.completed === true, lessonSha256: entry.lessonSha256 ?? null,
      generatedAt: new Date(this.sessionNow(entry)).toISOString(),
    });
  }

  /** Export the record, and write it under the learner's library (`_exports/concept-maps/`) when the
   * host has one, so that no harness has to copy it by hand. `sha256` is the digest of the bytes
   * written. forget_session reports that folder among what stays on disk. */
  async exportConceptMap(id: string): Promise<ConceptMapExport | null> {
    const record = this.conceptMapRecord(id);
    if (!record) return null;
    const locale = displayLocale(record.lesson.language);
    const library = this.opts.libraryRoot;
    if (!library) return { record, saved_to: null, sha256: null, display_markdown: conceptMapExportMarkdown(null, locale) };
    const dir = join(library, EXPORTS_DIR, "concept-maps");
    await mkdir(dir, { recursive: true });
    const stamp = record.generated_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const base = `${safeSegment(record.lesson.bundle_id)}-${stamp}`;
    let path = join(dir, `${base}.json`);
    for (let n = 2; existsSync(path); n += 1) path = join(dir, `${base}-${n}.json`);
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, "utf-8");
    await writeFile(path, bytes, { flag: "wx" });
    return {
      record, saved_to: path, sha256: createHash("sha256").update(bytes).digest("hex"),
      display_markdown: conceptMapExportMarkdown(path, locale),
    };
  }

  private conceptMapOf(entry: SessionEntry, moment: ConceptMapMoment): ConceptMap | null {
    if (entry.kind !== "lesson" || entry.bundle.concepts.length < 2) return null;
    return buildConceptMap({
      concepts: entry.bundle.concepts,
      scenes: entry.bundle.scenes.map((scene) => ({
        id: scene.id, type: scene.type, concept_refs: "concept_refs" in scene ? scene.concept_refs : [],
      })),
      lwg: entry.bundle.learning_workflow_graph ?? null,
      path: entry.session.learnerPath(),
      currentSceneId: entry.completed ? null : entry.session.currentPresentation().scene.id,
      moment, locale: displayLocale(entry.bundle.metadata.language),
    });
  }

  /** Whether this transition is a moment to show the concept map, and which. Not on every question:
   * a prerequisite detour and the return from it, a scene that draws on several concepts, the end of
   * the lesson (the whole map); the first scene of a concept (one position line). */
  private conceptMapMoment(entry: SessionEntry, transition: Transition): ConceptMapMoment | null {
    if (entry.kind !== "lesson" || entry.bundle.concepts.length < 2) return null;
    const primaryOf = (sceneId: string): string | undefined => {
      const scene = entry.bundle.scenes.find((s) => s.id === sceneId);
      return scene && "concept_refs" in scene ? scene.concept_refs[0] : undefined;
    };
    const seen = (entry.conceptMapSeen ??= {
      // Everything already served counts as announced, so a resumed lesson does not re-announce it.
      concepts: new Set(entry.session.learnerPath().steps.map((step) => primaryOf(step.scene_id)).filter((c): c is string => c !== undefined)),
      syntheses: new Set(), onDetour: false,
    });
    if (transition.kind === "complete") return "complete";
    const next = transition.presentation.scene;
    const refs = "concept_refs" in next ? next.concept_refs : [];
    const opens = refs[0] !== undefined && !seen.concepts.has(refs[0]);
    if (refs[0] !== undefined) seen.concepts.add(refs[0]);
    const navigation = transition.navigation?.kind;
    if (navigation === "remediate") { seen.onDetour = true; return "detour"; }
    if (seen.onDetour && navigation !== "replay" && navigation !== "remediate_alt") { seen.onDetour = false; return "detour_return"; }
    if (refs.length >= 2 && !seen.syntheses.has(next.id)) { seen.syntheses.add(next.id); return "synthesis"; }
    return opens ? "new_concept" : null;
  }

  /** Every lesson concept, with null until a graded answer actually measured it. */
  private publicMastery(entry: SessionEntry): Record<string, number | null> {
    const states = entry.session.getState().concept_states;
    return Object.fromEntries(entry.bundle.concepts.map(({ id }) => {
      const state = states[id];
      return [id, state && state.total_attempts > 0 ? masteryOf(state) : null];
    }));
  }

  /** The file channel shows these same completion groups, including after a final recall rating. */
  masterySummaryMarkdown(id: string): string {
    const entry = this.require(id);
    const split = completionSplit({ mastery: this.publicMastery(entry), finalState: entry.session.getState() });
    return completionGroupsMarkdown(split, displayLocale(entry.bundle.metadata.language),
      (conceptId) => entry.bundle.concepts.find((concept) => concept.id === conceptId)?.title ?? conceptId);
  }

  /** A transition as served: the self-rating request names its scene, a completed lesson says when its
   * concepts come back (review_plan), the verdict carries the earned text and cited passages, and the
   * transition the public text (see chat-display.ts).
   *
   * I-2: what an answer releases waits until the learner leaves the scene for good (leavesForGood).
   * Before that — the same item again, or another item on the same point — the verdict carries
   * neither the scene's passages, kept on the entry and released with the answer that leaves it
   * (releasedSources), nor its reference (key points, model answer), nor a request to rate recall
   * against that reference: the retried item's own verdict brings its reference. */
  private servedTransition(entry: SessionEntry, transition: Transition, warning?: string): ServedTransition {
    const sceneTitle = (sceneId: string) => entry.bundle.scenes.find((s) => s.id === sceneId)?.title;
    const conceptLabel = (conceptId: string) => entry.bundle.concepts.find((c) => c.id === conceptId)?.title ?? conceptId;
    const lines = "presentation" in transition ? this.screenLines(entry, transition.presentation) : undefined;
    const ctx = {
      sceneTitle, conceptLabel, locale: displayLocale(entry.bundle.metadata.language), review: entry.kind === "review",
      timeZone: this.zone,
      authoring: entry.authoring,
      ...lines,
    };
    const answered = transition.verdict ? entry.bundle.scenes.find((s) => s.id === transition.verdict?.scene_id) : undefined;
    const leaving = answered === undefined || leavesForGood(transition, answered);
    const sources = transition.verdict ? releasedSources(entry, transition, answered, leaving) : [];
    const verdict = transition.verdict && !leaving ? withoutReference(transition.verdict, answered) : transition.verdict;
    const selfRating = transition.self_rating && verdict && (leaving || !hasReference(transition.verdict))
      ? { ...transition.self_rating, scene_id: verdict.scene_id } : undefined;
    const reviewPlan = transition.kind === "complete" ? this.reviewPlanOf(entry) : undefined;
    const presentation = "presentation" in transition ? this.served(entry, transition.presentation, lines) : undefined;
    const { self_rating: _engineRequest, ...engineTransition } = transition;
    const summary = transition.kind === "complete" ? { ...transition.summary, mastery: this.publicMastery(entry) } : undefined;
    const mapMoment = this.conceptMapMoment(entry, transition);
    const conceptMap = mapMoment ? this.conceptMapOf(entry, mapMoment) : null;
    const base = {
      ...engineTransition,
      ...(conceptMap ? { concept_map: conceptMap } : {}),
      ...(summary ? { summary, completion: completionSplit(summary) } : {}),
      ...(verdict ? { verdict } : {}),
      ...(presentation ? { presentation } : {}),
      ...(selfRating ? { self_rating: selfRating } : {}),
      ...(reviewPlan ? { review_plan: reviewPlan } : {}),
      ...(warning ? { persistence_warning: warning } : {}),
    } as PublicTransition & {
      self_rating?: SelfRatingRequest & { scene_id: string }; review_plan?: ReviewPlan; persistence_warning?: string; completion?: CompletionSplit;
      concept_map?: ConceptMap;
    };
    return {
      ...base,
      ...(verdict ? { verdict: {
        ...verdict, ...(sources.length ? { sources } : {}), display_markdown: verdictMarkdown(base, sources, ctx),
      } } : {}),
      display_markdown: transitionMarkdown(base, ctx),
    } as ServedTransition;
  }

  /** HJ-1: when a finished lesson's concepts come back for review, earliest first. */
  private reviewPlanOf(entry: SessionEntry): ReviewPlan {
    const lessonConcepts = new Set(entry.bundle.concepts.map((c) => c.id));
    const reviewed = Object.values(pick(entry.memory, lessonConcepts)).filter((m) => m.reps > 0)
      .map((m) => ({ id: m.concept_id, at: dueAt(m) })).sort((a, b) => a.at - b.at);
    const first = reviewed[0];
    return {
      next_due_at: first ? Math.round(first.at) : null,
      next_due_date: first ? calendarDate(first.at, this.zone) : null,
      concepts: reviewed.map((r) => r.id),
    };
  }

  currentPresentation(id: string): ServedPresentation {
    const entry = this.require(id);
    return this.served(entry, entry.session.currentPresentation());
  }
  /** INT-STUDIUM-058: the facts behind the learner's orientation (orientation.ts) — the screen's
   * position, its concept, the durations left, what the session waits for, how it last routed. Ids,
   * types, titles and durations only: no scene text, key, hint or reveal. `nowMs` sets the moment
   * reviews are due at. */
  orientationFacts(id: string, nowMs?: number): OrientationFacts {
    return this.orientationFactsOf(this.require(id), nowMs);
  }
  /** The same from the entry: a first screen is served before its session can be looked up by id. */
  private orientationFactsOf(entry: SessionEntry, nowMs?: number): OrientationFacts {
    const run = entry.completed ? null : this.runStatusOf(entry);
    return orientationFacts(entry, {
      conceptMap: this.conceptMapOf(entry, "on_request"),
      reviewsDue: this.reviewQueueOf(entry, nowMs).filter((item) => item.due).length,
      runPending: run !== null && run.run_manifest !== null && !run.learner_run_recorded,
    });
  }
  /** INT-STUDIUM-058: the voice of this session's lesson — who signs it, whether it was reviewed, who
   * drafted it (orientation.ts authorVoice). */
  authorVoice(id: string): Voice { return this.authorVoiceOf(this.require(id)); }
  /** Nobody signs a review as a whole: its `validated_by` is a placeholder (review-session.ts), never a
   * name. */
  private authorVoiceOf(entry: SessionEntry): Voice {
    const voice = authorVoice(entry.authoring, entry.bundle.validated_by);
    return entry.kind === "review" && voice.kind === "author" ? { ...voice, name: null } : voice;
  }
  /** Who wrote this session's lesson, whether a teacher validated it, its approval record and whether
   * this host has a judge model (see authoringOf). Read once, when the session started. */
  authoring(id: string): AuthoringBlock { return this.require(id).authoring; }
  /** C3: who drafted this session's lesson — an agent, the learner, or a teacher. */
  draftedBy(id: string): DraftedBy { return draftedByOf(this.require(id).bundle.metadata); }

  /** Read the public presentation-language policy for a live session. */
  sessionLanguage(id: string) {
    const entry = this.require(id);
    const sourceLanguage = entry.bundle.metadata.language;
    const selectedLanguage = entry.presentationLanguage ?? null;
    return {
      source_language: sourceLanguage,
      selected_language: selectedLanguage,
      effective_language: selectedLanguage ?? sourceLanguage,
      translation_required: selectedLanguage !== null && selectedLanguage !== sourceLanguage,
    };
  }

  /** Change presentation language only; null restores the bundle's source-language fallback. */
  setPresentationLanguage(id: string, language: string | null) {
    const entry = this.require(id);
    if (language === null) delete entry.presentationLanguage;
    else entry.presentationLanguage = normalizePresentationLanguage(language);
    return this.sessionLanguage(id);
  }

  /** Learner-private journal; never included in public scene context or teacher aggregates. */
  experimentJournal(id: string): ExperimentDocument {
    this.require(id);
    return this.experiments.get(id)!.read();
  }

  /** Append an explicitly learner-owned contribution without grading or moving the lesson. */
  recordExperiment(id: string, input: unknown): ExperimentDocument {
    this.assertNotErased(id, this.require(id));
    const scene = this.require(id).session.currentPresentation().scene;
    return this.experiments.get(id)!.record(input, scene.id);
  }
  /** The normalized render manifest for the current scene — the artifacts a UI pairs with this
   * scene (figure, equation, interactive plot, executed reference run, …). Empty for a plain quiz.
   * A review scene's relative paths resolve in the folder of the lesson it comes from. */
  sceneArtifacts(id: string): RenderAsset[] {
    const e = this.require(id);
    const scene = e.session.currentPresentation().scene;
    const baseDir = e.reviewOrigins?.[scene.id]?.baseDir ?? e.baseDir;
    const assets = sceneRenderAssets(scene).map((a) => inlineFileAsset(a, baseDir, e.assetCache));
    // A LEARNER-TIME RUN scene (run_manifest present) WITHHOLDS its author executed run — the learner
    // produces a fresh result by running it (parity with the file channel + publicScene).
    if ((scene as { run_manifest?: unknown }).run_manifest) return assets.filter((a) => a.kind !== "executed_result");
    return assets;
  }
  /** The notation the lesson has already given for the current scene's concepts: the legends of the
   * equations carried by the scenes up to this one (in lesson order) that share a concept with it,
   * each symbol once, first meaning kept. Public material only — legends travel with the public scene
   * — so a harness may show it at any time, and it is not a metered hint (no M5 discount). Empty when
   * the scene names no concept or no such equation has a legend. */
  sceneNotation(id: string): NotationEntry[] {
    const e = this.require(id);
    const { scene, index } = e.session.currentPresentation();
    const concepts = new Set(conceptsOf(scene));
    if (concepts.size === 0) return [];
    const upTo = e.bundle.scenes.findIndex((s) => s.id === scene.id);
    const scenes = e.bundle.scenes.slice(0, (upTo >= 0 ? upTo : index) + 1);
    const seen = new Set<string>();
    const notation: NotationEntry[] = [];
    for (const earlier of scenes) {
      if (!conceptsOf(earlier).some((c) => concepts.has(c))) continue;
      for (const asset of sceneRenderAssets(earlier)) {
        if (asset.kind !== "equation_latex") continue;
        for (const { symbol, meaning } of asset.legend ?? []) {
          if (seen.has(symbol)) continue;
          seen.add(symbol);
          notation.push({ symbol, meaning });
        }
      }
    }
    return notation;
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

  /** The run manifest PLUS whether this session already holds the learner's attested run for the
   * current scene's task card (a revisit after a graph detour). When it does, a harness may re-run or
   * simply `submit_response {kind:"ack"}`; nobody has to re-provision an environment to move on. */
  runStatus(id: string): { run_manifest: RunManifest | null; learner_run_recorded: boolean; landmark: string | null } {
    return this.runStatusOf(this.require(id));
  }
  private runStatusOf(entry: SessionEntry): { run_manifest: RunManifest | null; learner_run_recorded: boolean; landmark: string | null } {
    const scene = entry.session.currentPresentation().scene as { run_manifest?: RunManifest; task_card_id?: string };
    const run = scene.run_manifest && scene.task_card_id ? entry.session.learnerRunFor(scene.task_card_id) : null;
    return { run_manifest: scene.run_manifest ?? null, learner_run_recorded: !!run, landmark: run?.landmark ?? null };
  }

  /** Ingest a learner-produced run_result — Studium NEVER executes (the operator ran it in the workspace).
   * The SHARED run-ingest core used by BOTH channels (MCP submit_run_result + the file channel's
   * SessionWorkspace.ingestRun), so they cannot drift. Gates advance on `ran && passed`: a passing run
   * records the learner's OWN executed result (keyed by the run scene's task_card_id, so a later
   * reference_from_run judgment grounds on it) and advances via an ack; a non-completed / failed-checks
   * run does NOT advance. Guards a non-run scene (no run_manifest) so it never advances an arbitrary scene. */
  async ingestRunResult(
    id: string, result: RunResult,
  ): Promise<{ status: "ran" | "run_incomplete" | "run_failed_checks" | "not_a_run_scene"; transition: ServedTransition | null; learnerRunRecorded: boolean; attested: boolean; attestationReasons: string[] }> {
    const scene = this.require(id).session.currentPresentation().scene as { run_manifest?: RunManifest; task_card_id?: string };
    if (!scene.run_manifest) return { status: "not_a_run_scene", transition: null, learnerRunRecorded: false, attested: false, attestationReasons: [] };
    if (!result.ran) return { status: "run_incomplete", transition: null, learnerRunRecorded: false, attested: false, attestationReasons: [] };
    if (!result.passed) return { status: "run_failed_checks", transition: null, learnerRunRecorded: false, attested: false, attestationReasons: [] };
    // ATTESTATION (brain-only): verify the returned run against its manifest. An unverifiable "theatre" run
    // still advances (the pure-delegation gate is ran&&passed), but is QUARANTINED from grounding a judgment
    // — so it can never feed trust_calibration. Only an attested run records the learner's result.
    const attestation = verifyRunAttestation(scene.run_manifest, result);
    let learnerRunRecorded = false;
    if (scene.task_card_id && attestation.trusted) {
      const learnerRun = runResultToReferenceRun(result);
      this.recordLearnerRun(id, scene.task_card_id, learnerRun);
      learnerRunRecorded = true;
      // PER-RUN REGENERATION: regenerate downstream spot_the_flaw judgments from the learner's OWN run
      // (server-side) so the planted flaws match THEIR numbers — sound for a stochastic capsule too.
      if (this.opts.judgmentGenerator) await this.regenerateDownstreamJudgments(id, scene.task_card_id, learnerRun);
    }
    const transition = await this.applyResponse(id, { kind: "ack" } as ResponseInput);
    return { status: "ran", transition, learnerRunRecorded, attested: attestation.trusted, attestationReasons: attestation.reasons };
  }

  /** Regenerate every spot_the_flaw scene grounded on this capsule run (reference_from_run === taskCardId)
   * AND flagged regenerate_from_run: ask the injected generator for a flawed reading + answer key built on
   * the learner's OWN run, and set it as a server-side scene override (publicScene still strips the claims).
   * No-op without a generator (the authored, deterministic flaws stand). */
  private async regenerateDownstreamJudgments(id: string, taskCardId: string, refRun: ReferenceRun): Promise<void> {
    const gen = this.opts.judgmentGenerator;
    if (!gen) return;
    const e = this.require(id);
    for (const sc of e.bundle.scenes) {
      const s = sc as { id: string; type: string; reference_from_run?: string; regenerate_from_run?: boolean; concept_refs?: string[]; title?: string };
      if (s.type !== "spot_the_flaw" || !s.regenerate_from_run || s.reference_from_run !== taskCardId) continue;
      const out = await gen.generateFlaw({ reference_run: refRun, concept_id: s.concept_refs?.[0] ?? "", objective_text: s.title ?? "" });
      e.session.setSceneOverride(s.id, {
        flawed_content: out.flawed_content, claims: out.claims, model_correction: out.model_correction,
        ...(out.rubric ? { rubric: out.rubric } : {}),
      });
    }
  }

  /** Submit a response. A chat reply (`{kind: "reply", text}`) becomes the current scene's input, and a
   * quiz choice must name a displayed id — both refused in one line otherwise (reply-mapping.ts). */
  async respond(id: string, input: HostResponseInput): Promise<ServedTransition> {
    return this.sessionWrite(id, async (entry) => {
      const runStatus = this.runStatus(id);
      if (runStatus.run_manifest && !runStatus.learner_run_recorded) throw new RunRequiredError();
      const scene = this.require(id).session.currentPresentation().scene;
      const engineInput = input.kind === "reply"
        ? replyToInput(scene, input.text, (publicScene(scene) as { deck?: Array<{ token: string }> }).deck)
        : checkDisplayedChoice(scene, input);
      return this.applyResponseLocked(entry, engineInput);
    });
  }

  /** Apply a validated response; run ingestion uses this after its own gate.
   *
   * L-11 (CC-6): once the engine recorded the answer the session has moved on, so a write-through that
   * fails (an unreadable profile, a full disk, a folder it cannot write) does not lose the transition:
   * it is served with `persistence_warning`, and a retry is never graded against the next scene. */
  private async applyResponse(id: string, input: ResponseInput): Promise<ServedTransition> {
    return this.sessionWrite(id, (entry) => this.applyResponseLocked(entry, input));
  }

  /** Apply and persist while holding the learner lock, so forget also waits for engine writes. */
  private async applyResponseLocked(e: SessionEntry, input: ResponseInput): Promise<ServedTransition> {
    const transition = await e.session.respond(input);
    e.responses += 1;
    recordNavigation(e, transition);
    const moved = this.carryEngineMemory(e, e.session.getState());
    const complete = transition.kind === "complete";
    if (complete) e.completed = true;
    let warning: string | undefined;
    try {
      // Persist local mastery claims when the lesson completes (no-op for the in-memory sink; writes the
      // .jsonld for FileMasteryClaimSink). NOT flushed on forget() — that is the RGPD-delete path.
      if (complete) await this.flushSessionOutputs(e);
      await this.persistLearner(e, { moved, sceneId: transition.verdict?.scene_id ?? null, complete });
    } catch (error) {
      warning = persistenceWarning(error);
    }
    await this.publishStatus(e);
    return this.servedTransition(e, transition, warning);
  }

  /** INT-STUDIUM-058 (N8): in durable mode, say where this session stands in the learner's folder, for
   * a harness status line (status-file.ts) — the same line its screens end with. Called once the
   * session has moved (a first screen, an answer, a self-rating), while the learner's lock is held.
   * Nothing in memory-only mode, nothing for a learner erased under the session. A status that cannot
   * be written is left as it was: the answer is recorded and served without it. */
  private async publishStatus(entry: SessionEntry): Promise<void> {
    const pseudonym = entry.profilePseudonym;
    if (this.dataDir === null || !pseudonym || entry.erased) return;
    const orientation = orientationFrom(this.orientationFactsOf(entry));
    const line = statusLine(orientation, entry.bundle.metadata.title, displayLocale(entry.bundle.metadata.language));
    try {
      await writeStatusFile(this.dataDir, pseudonym, { status_line: line, orientation });
      this.statusWriters.set(pseudonym, entry);
    } catch { /* a display aid: see above */ }
  }

  /** Take the learner's status file away when the session that wrote it closes: no session plays any
   * more. Left alone when another session of the learner, here or in another server on the same data
   * folder, wrote it since. */
  private async retireStatus(entry: SessionEntry): Promise<void> {
    const pseudonym = entry.profilePseudonym;
    if (this.dataDir === null || !pseudonym || this.statusWriters.get(pseudonym) !== entry) return;
    this.statusWriters.delete(pseudonym);
    try {
      if (await statusFileOwner(this.dataDir, pseudonym) === process.pid) await removeStatusFile(this.dataDir, pseudonym);
    } catch { /* the file stays until this server stops; the status-line script then ignores it */ }
  }

  /** Carry the graded answers the engine just folded into its memory (RT-3) over to the learner's. A
   * concept a self-rating moved ahead of the engine gets the same answer folded onto its own memory
   * instead, so neither review is lost. Returns the concepts whose memory moved. */
  private carryEngineMemory(entry: SessionEntry, state: LearnerState): string[] {
    const engine = state.concept_memory ?? {};
    const moved: string[] = [];
    for (const [conceptId, memory] of Object.entries(engine)) {
      if (sameReview(entry.engineMemory[conceptId], memory)) continue;
      moved.push(conceptId);
      entry.moved.add(conceptId);
      if (!entry.selfRated.has(conceptId)) { entry.memory[conceptId] = memory; continue; }
      const answer = lastGradedAnswer(state, conceptId);
      if (answer) {
        entry.memory[conceptId] = reviewMemory(entry.memory[conceptId] ?? defaultMemoryState(conceptId), gradeFromAnswer(answer), answer.at);
      }
    }
    entry.engineMemory = structuredClone(engine);
    return moved;
  }

  /** C4: the learner's own rating of their recall after an uncertified production answer (again |
   * hard | good | easy). FSRS input only: the rated concept's memory moves, source `self_rated`; its
   * mastery never does. The session refuses a rating no answer asked for (a certified answer, a scene
   * already rated) and an unknown grade. */
  async rateRecall(id: string, sceneId: string, grade: SelfRating): Promise<RecallRating> {
    return this.sessionWrite(id, (entry) => this.rateRecallLocked(entry, sceneId, grade));
  }

  private async rateRecallLocked(e: SessionEntry, sceneId: string, grade: SelfRating): Promise<RecallRating> {
    const rating = await e.session.rateRecall(sceneId, grade);
    // L-1: the rating is stamped by the session's clock (anchored at its now_ms), and so is the review.
    const ratedAt = Date.parse(rating.rated_at);
    const at = Number.isNaN(ratedAt) ? this.sessionNow(e) : ratedAt;
    // L-9 (RFR-10): the rating schedules every concept of the rated scene — its concept_refs, which the
    // session recorded with the request — not only the first one.
    const conceptIds = rating.concept_ids.length ? [...new Set(rating.concept_ids)] : [rating.concept_id];
    for (const conceptId of conceptIds) {
      e.memory[conceptId] = reviewMemory(e.memory[conceptId] ?? defaultMemoryState(conceptId), rating.fsrs_grade, at);
      e.selfRated.add(conceptId);
      e.moved.add(conceptId);
    }
    let warning: string | undefined;
    try { await this.persistLearner(e, { moved: conceptIds, sceneId, complete: false }); }
    catch (error) { warning = persistenceWarning(error); } // L-11: the rating counts in this session
    await this.publishStatus(e);
    const next = Math.round(Math.min(...conceptIds.map((conceptId) => dueAt(e.memory[conceptId]!))));
    return {
      scene_id: sceneId, concept_id: conceptIds[0]!, concept_ids: conceptIds, grade, source: "self_rated",
      next_review_at: next, next_review_date: calendarDate(next, this.zone),
      review_plan: this.reviewPlanOf(e),
      ...(warning ? { persistence_warning: warning } : {}),
      display_markdown: recallRatedMarkdown(next, displayLocale(e.bundle.metadata.language), this.zone, warning !== undefined),
    };
  }


  private async flushSessionOutputs(entry: SessionEntry): Promise<void> {
    await entry.deps.masteryClaimSink?.flush();
    await entry.deps.telemetry.flush();
  }

  /** Write-through (RT-3, HJ-1), after every answer and self-rating and when a session closes: the
   * learner's profile gets the concept states this session changed and every memory at least as recent
   * as its own, and the study record the lesson and scene each moved concept was answered in, and how
   * far the lesson got. A review session records no lesson of its own and never a completed lesson. */
  private async persistLearner(
    entry: SessionEntry, change: { moved: readonly string[]; sceneId: string | null; complete: boolean },
  ): Promise<void> {
    const pseudonym = entry.profilePseudonym;
    if (!pseudonym) return;
    if (this.erasedUnder(entry)) { entry.erased = true; return; }
    await this.mergeLearner(entry, pseudonym, change);
  }

  /** Serialize complete engine/store operations and erasure, in this host and across processes. */
  private async learnerOperation<T>(pseudonym: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!pseudonym) return fn();
    const operation = (this.learnerWrites.get(pseudonym) ?? Promise.resolve()).then(() => this.underLearnerLock(pseudonym, fn));
    const queued = operation.then(() => undefined, () => undefined);
    this.learnerWrites.set(pseudonym, queued);
    try { return await operation; }
    finally { if (this.learnerWrites.get(pseudonym) === queued) this.learnerWrites.delete(pseudonym); }
  }

  /** Recheck the forget generation after waiting for preceding operations. */
  private sessionWrite<T>(id: string, fn: (entry: SessionEntry) => Promise<T>): Promise<T> {
    const entry = this.require(id);
    return this.learnerOperation(entry.profilePseudonym, () => {
      this.assertNotErased(id, entry);
      return fn(entry);
    });
  }

  private learnerTombstone(pseudonym: string): string | null {
    return this.dataDir === null ? null : readLearnerTombstone(this.dataDir, pseudonym);
  }

  /** L-11: one load, merge and save of the learner's files at a time across processes — the lock file of
   * their folder in durable mode — and no empty folder left behind when nothing was written. */
  private async underLearnerLock<T>(pseudonym: string, fn: () => Promise<T>): Promise<T> {
    if (this.dataDir === null) return fn();
    const dir = join(this.dataDir, safeSegment(pseudonym));
    try { return await withLearnerLock(this.dataDir, pseudonym, fn); }
    finally { await removeIfEmpty(dir); }
  }

  private async mergeLearner(
    entry: SessionEntry, pseudonym: string, change: { moved: readonly string[]; sceneId: string | null; complete: boolean },
  ): Promise<void> {
    const now = entry.deps.clock.now();
    const state = entry.session.getState();
    const stored = await this.profileStore.load(pseudonym); // L-11: an unreadable file throws, never reads as none
    // L-11: a profile this session read or wrote and that is gone now was erased — by a forget here or in
    // another server on the same folder: never write the learner back.
    if (stored === null && entry.profileSeen) { entry.erased = true; return; }
    const base = stored ?? defaultLearnerProfile(pseudonym, now);
    const changed = Object.fromEntries(Object.entries(state.concept_states)
      .filter(([id, cs]) => JSON.stringify(cs) !== entry.conceptStatesAtStart[id]));
    let profile = mergeConceptStatesIntoProfile(base, { ...state, concept_states: changed }, now);
    profile = mergeConceptMemoryIntoProfile(profile, notOlderThan(entry.memory, profile.concept_memory), now);
    if (change.complete && entry.kind === "lesson") profile = recordCompletedLesson(profile, state.lesson_id);
    await this.profileStore.save(profile);
    entry.profileSeen = true;

    if (!change.moved.length && (entry.kind === "review" || entry.responses === 0)) return;
    const record = (await this.studyStore.load(pseudonym)) ?? emptyStudyRecord();
    // RFR-06: the minutes a day the learner gave for the lesson they play are theirs from now on.
    if (entry.minutesPerDay !== undefined) record.minutes_per_day = entry.minutesPerDay;
    for (const conceptId of change.moved) {
      const route = this.routeOf(entry, conceptId, change.sceneId);
      if (route) record.concepts[conceptId] = route;
    }
    if (entry.kind === "lesson" && entry.responses > 0) {
      const done = new Set(state.scenes_completed);
      const previous = record.lessons[entry.bundle.bundle_id];
      record.lessons[entry.bundle.bundle_id] = {
        bundle_ref: entry.bundleRef, bundle_id: entry.bundle.bundle_id, title: entry.bundle.metadata.title,
        language: entry.bundle.metadata.language,
        scenes_completed: entry.bundle.scenes.filter((s) => done.has(s.id)).length,
        total_scenes: entry.bundle.scenes.length,
        completed: change.complete || previous?.completed === true,
        updated_at: now,
      };
    }
    await this.studyStore.save(pseudonym, record);
  }

  /** Where a concept was just answered: this lesson and scene, or — in a review — the lesson and scene
   * the review item came from. */
  private routeOf(entry: SessionEntry, conceptId: string, sceneId: string | null): ConceptRoute | null {
    if (entry.kind === "review") {
      const origin = sceneId ? entry.reviewOrigins?.[sceneId] : undefined;
      return origin
        ? { bundle_ref: origin.bundle_ref, bundle_id: origin.bundle_id, scene_id: origin.scene_id, lesson_title: origin.lesson_title }
        : null;
    }
    const scene = (sceneId ? entry.bundle.scenes.find((s) => s.id === sceneId && s.concept_refs.includes(conceptId)) : undefined)
      ?? entry.bundle.scenes.find((s) => s.id === reinforcementSceneForConcept(entry.bundle, conceptId));
    if (!scene) return null;
    return { bundle_ref: entry.bundleRef, bundle_id: entry.bundle.bundle_id, scene_id: scene.id, lesson_title: entry.bundle.metadata.title };
  }

  /** Pull the next authored hint for the current quiz scene (scaffolding-gated, M5 discount).
   * Returns null when the scene is not a quiz, has no hints, or the per-visit cap is reached. */
  requestHint(id: string): HintResult | null {
    const entry = this.require(id);
    this.assertNotErased(id, entry);
    return entry.session.requestHint();
  }
  async submitTurn(id: string, text: string): Promise<void> {
    return this.sessionWrite(id, (entry) => entry.session.submitTurn(text));
  }
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
    const graph = lwgToGraphView(lwg, statuses, { title: e.bundle.metadata.title });
    // L-6: the generic graph scalar cannot hold null. Omit it when no answer measured the concept,
    // and expose explicit null mastery in attrs instead of showing the adapter's zero/prior score.
    graph.nodes = graph.nodes.map((node) => {
      if (node.type !== "concept") return node;
      const measured = (statuses[node.id]?.attempts ?? 0) > 0;
      const { value, ...rest } = node;
      return { ...rest, ...(measured ? { value } : {}), attrs: { ...node.attrs, mastery: measured ? value : null } };
    });
    return graph;
  }
  /** The host's "now" in ms: the injected clock when one is configured (see SessionHostOptions.clock),
   * else wall-clock. Default for every time-dependent read below. */
  private nowMs(): number {
    return this.opts.clock ? Date.parse(this.opts.clock.now()) : Date.now();
  }

  /** L-1: `nowMs` when the caller gives one — an integer epoch a Date can hold, else a RangeError —
   * else the host's now. */
  private nowOr(nowMs: number | undefined): number {
    return nowMs === undefined ? this.nowMs() : checkNowMs(nowMs);
  }

  /** L-1: a session's now — its own clock, anchored at the now_ms it was started with — unless the
   * caller gives one. */
  private sessionNow(entry: SessionEntry, nowMs?: number): number {
    return nowMs === undefined ? Date.parse(entry.deps.clock.now()) : checkNowMs(nowMs);
  }

  /** The concepts this lesson has reviewed: graded in its history (a resumed lesson included) or moved
   * in this session (an answer, a self-rating). Their memory is the session's; any other concept's is
   * the profile's. */
  private ownConcepts(entry: SessionEntry): Set<string> {
    return new Set([...gradedInHistory(entry.session.getState()), ...entry.moved]);
  }

  /** Spaced-repetition read: per concept this lesson has reviewed, whether it is due for review now,
   * when it next falls due, and its current retrievability. `nowMs` is injectable for deterministic
   * tests; defaults to the host's clock. A UI renders the due items as a "À réviser" cue. */
  reviewQueue(id: string, nowMs?: number): ReviewQueueItem[] {
    return this.reviewQueueOf(this.require(id), nowMs);
  }
  private reviewQueueOf(entry: SessionEntry, nowMs?: number): ReviewQueueItem[] {
    return reviewQueueFromMemory(pick(entry.memory, this.ownConcepts(entry)), this.sessionNow(entry, nowMs));
  }

  /** Union of this lesson's memory and the learner's cross-lesson memory, this lesson winning per
   * concept: what is due (mastered) and what to relearn (weak), each routed to a scene, and the
   * earliest review still ahead. */
  async reinforcementStatusForSession(
    id: string,
    requestedNow?: number,
  ): Promise<ReinforcementStatus> {
    const entry = this.require(id);
    const nowMs = this.sessionNow(entry, requestedNow);
    const own = this.ownConcepts(entry);
    const [profile, record] = entry.profilePseudonym
      ? await Promise.all([this.profileStore.load(entry.profilePseudonym), this.studyStore.load(entry.profilePseudonym)])
      : [null, null];
    const state = entry.session.getState();
    const session = statusOf(pick(entry.memory, own), masteryFromState(state), measuredOf(state.concept_states), nowMs,
      "session", entry.bundle, record);
    const carried = statusOf(omit(profile?.concept_memory ?? {}, own), masteryFromProfile(profile), measuredOf(profile?.concept_states),
      nowMs, "profile", entry.bundle, record);
    const ranked = [...session.ranked, ...carried.ranked]
      .sort((a, b) => b.target.priority - a.target.priority || Number(a.source === "profile") - Number(b.source === "profile"));
    return {
      due: ranked.map(({ source, target }) => routedTarget(entry.bundle, source, target, record)),
      relearn: [...session.relearn, ...carried.relearn],
      unmeasured: [...session.unmeasured, ...carried.unmeasured],
      has_history: session.has_history || carried.has_history,
      next_due_at: earliest(session.next_due_at, carried.next_due_at),
    };
  }

  /** Spaced-repetition ROUTER (vs the reviewQueue readout): the single most-urgent concept this lesson
   * reviewed to reinforce now, or null — the decision a selection loop acts on. */
  nextReinforcement(id: string, nowMs?: number): ReinforcementTarget | null {
    const entry = this.require(id);
    const memory = pick(entry.memory, this.ownConcepts(entry));
    return dueReinforcementTargetsFromMemory(memory, masteryFromState(entry.session.getState()), this.sessionNow(entry, nowMs))[0] ?? null;
  }

  /** ROUTE the FSRS decision to CONTENT: the id of the bundle scene that addresses the most-urgent
   * due concept (its `concept_refs` includes it), or null when nothing is due. A driver surfaces
   * this scene for a reinforcement pass instead of advancing linearly. */
  nextReinforcementScene(id: string, nowMs?: number): string | null {
    const target = this.nextReinforcement(id, nowMs);
    return target ? reinforcementSceneForConcept(this.require(id).bundle, target.concept_id) : null;
  }

  /** Learner-facing metacognitive-calibration verdicts (number-free, mastery never leaked) for every
   * concept that has a checkpointed confidence gap. The student-facing complement to the engine's
   * calibration rule: after a meta_checkpoint a UI shows "ta confiance était bien/sur/sous-calibrée".
   * Pass a `concept_id` to scope to one concept. */
  calibrationFor(id: string, concept_id?: string): CalibrationVerdict[] {
    const session = this.require(id).session;
    const state = session.getState();
    const locale = session.currentPresentation().locale;
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
    return entries.map((entry) => calibrationVerdict(entry, locale)).filter((v): v is CalibrationVerdict => v !== null);
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
    // Distinct raters, not rows: `k` is the number the floor is applied to, and a row count
    // here would disagree with the aggregate the teacher later reads (see room.ts).
    const k = distinctRaters(room.ratings, targetSessionId);
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

  /** Close a live handle while preserving both bundle state and longitudinal memory. The session closes
   * even when its last write-through fails (L-11): the reply then says why the progress was not saved.
   * A session whose learner's data was erased while it was open closes without writing anything. */
  async close(id: string): Promise<{ persistence_warning?: string }> {
    const entry = this.require(id);
    return this.learnerOperation(entry.profilePseudonym, async () => {
      let warning: string | undefined;
      try {
        if (!this.erasedUnder(entry)) {
          await this.flushSessionOutputs(entry);
          await this.persistLearner(entry, { moved: [], sceneId: null, complete: false });
        }
      } catch (error) {
        warning = persistenceWarning(error);
      } finally {
        this.registry.delete(id);
        this.experiments.delete(id);
      }
      await this.retireStatus(entry);
      return warning ? { persistence_warning: warning } : {};
    });
  }

  /** L-11: whether the learner's data was erased while this session was open — forgotten in this host
   * after it opened; its profile gone although the session read or wrote it (a forget in another
   * server on the same data folder); or the data folder erased, or keyed afresh, under it. */
  private erasedUnder(entry: SessionEntry): boolean {
    if (entry.erased) return true;
    const pseudonym = entry.profilePseudonym;
    const forgottenAt = pseudonym ? this.forgotten.get(pseudonym) : undefined;
    if (forgottenAt !== undefined && forgottenAt > entry.openedAt) return true;
    if (this.dataDir === null) return false;
    if (pseudonym && this.learnerTombstone(pseudonym) !== (entry.learnerTombstone ?? null)) return true;
    if (entry.keyedBy !== undefined) {
      if (!existsSync(join(this.dataDir, KEY_SOURCE_FILE))) return true;
      const current = currentInstallSecret(this.dataDir);
      if (entry.keyedBy === LEGACY_PSEUDO_SECRET ? current !== null : current !== entry.keyedBy) return true;
    }
    return pseudonym !== undefined && entry.profileSeen
      && !existsSync(join(this.dataDir, safeSegment(pseudonym), "profile.json"));
  }

  /** L-11: refuse — and close — a session whose learner's data was erased while it was open, before it
   * writes anything (its answer, its lesson state, its journal): nothing brings the learner back. */
  private assertNotErased(id: string, entry: SessionEntry): void {
    if (!this.erasedUnder(entry)) return;
    entry.erased = true;
    this.erasedIds.add(id);
    this.registry.delete(id);
    this.experiments.delete(id);
    throw new SessionHostNotFoundError(id, "erased");
  }

  /** L-11: close a session of a learner being forgotten without erasing its lesson, which stays on disk
   * (forget names it as kept): its outputs are flushed, nothing is written to the learner's profile. */
  private async detach(id: string, entry: SessionEntry): Promise<void> {
    entry.erased = true;
    this.erasedIds.add(id);
    this.registry.delete(id);
    this.experiments.delete(id);
    await this.flushSessionOutputs(entry).catch(() => undefined);
  }

  /** The learner's profile and study record as forget reports them: a file that exists and does not
   * parse is erased like any other (it reads as present). */
  private async recordsToErase(pseudonym: string): Promise<[LearnerProfile | null, StudyRecord | null]> {
    const present = <T>(load: Promise<T | null>, unreadable: T) =>
      load.catch((error: unknown) => (error instanceof LearnerDataError ? unreadable : Promise.reject(error)));
    return Promise.all([
      present(this.profileStore.load(pseudonym), defaultLearnerProfile(pseudonym, new Date(0).toISOString())),
      present(this.studyStore.load(pseudonym), emptyStudyRecord()),
    ]);
  }

  /** forget_session {session_id} (L-13): erase this lesson's progress — its state, answers, mastery
   * claims, telemetry and experiment journal, the whole folder it has on disk — and the learner's
   * cross-lesson profile and review schedule. Says what it erased and what stays: the progress in the
   * learner's other lessons, the lessons of the library and their sources. No empty folder is left. */
  async forget(id: string): Promise<ForgetReport> {
    const e = this.require(id);
    const pseudonym = e.profilePseudonym;
    // L-11: from now on no session of this learner opened before writes them back, queued writes included.
    if (pseudonym) this.forgotten.set(pseudonym, ++this.sequence);
    return this.learnerOperation(pseudonym, async () => {
      if (pseudonym && this.dataDir) await writeLearnerTombstone(this.dataDir, pseudonym);
      const [profile, record] = pseudonym ? await this.recordsToErase(pseudonym) : [null, null];
      await this.eraseSession(id, e);
      // L-11 (CC-2): the learner's other live sessions close. Another session of this lesson is this
      // lesson's progress too, and is erased with it (what it holds would bring its folder back); the
      // other lessons stay on disk (named as kept).
      for (const [otherId, other] of this.registry.entries()) {
        if (!pseudonym || other.profilePseudonym !== pseudonym) continue;
        if (sameLesson(other, e)) await this.eraseSession(otherId, other);
        else await this.detach(otherId, other);
      }
      const erased: ForgetItem[] = e.kind === "lesson" ? [{ kind: "lesson_progress", lessons: [e.bundle.metadata.title] }] : [];
      // RGPD: also erase the learner-level CROSS-LESSON profile and study record (the learner's
      // longitudinal aggregate) — "right to be forgotten" covers data carried across lessons too.
      if (pseudonym) {
        await this.eraseLearnerRecords(pseudonym);
        if (profile) erased.push({ kind: "learner_profile" });
        if (record) erased.push({ kind: "study_record" });
      }
      const others = Object.values(record?.lessons ?? {})
        .filter((lesson) => e.kind === "review" || lesson.bundle_id !== e.bundle.bundle_id).map((lesson) => lesson.title);
      const kept: ForgetItem[] = [
        ...(others.length ? [{ kind: "other_lessons_progress" as const, lessons: sortedTitles(others) }] : []),
        ...this.keptOnDisk(await this.catalog()),
      ];
      this.afterForget();
      return this.forgetReport("lesson", erased, kept, displayLocale(e.bundle.metadata.language));
    });
  }

  /** forget_session {learner_id} (L-13, R-en-07): erase everything this host keeps of the learner, with
   * no live session needed — every lesson's progress (their live sessions are closed), the
   * cross-lesson profile and the review schedule — and say what stays, as forget does. */
  async forgetLearner(learnerId: string = this.defaultLearnerId): Promise<ForgetReport> {
    if (this.holdsNoLearner()) return this.forgetReport("learner", [], this.keptOnDisk(await this.catalog()), DEFAULT_LOCALE);
    const pseudonymOf = this.deps().pseudonym;
    const profilePseudonym = await pseudonymOf.get(learnerId, PROFILE_PSEUDONYM_SCOPE);
    // L-11: from now on no session of this learner opened before writes them back.
    this.forgotten.set(profilePseudonym, ++this.sequence);
    return this.learnerOperation(profilePseudonym, async () => {
      if (this.dataDir) await writeLearnerTombstone(this.dataDir, profilePseudonym);
      const [[profile, record], catalog] = await Promise.all([this.recordsToErase(profilePseudonym), this.catalog()]);
      const lessons = new Map<string, string>(); // bundle_id → title, of every lesson erased
      let locale = displayLocale(this.recordLanguage(record) ?? DEFAULT_LOCALE);
      for (const [id, entry] of this.registry.entries()) {
        if (entry.profilePseudonym !== profilePseudonym) continue;
        if (entry.kind === "lesson") {
          lessons.set(entry.bundle.bundle_id, entry.bundle.metadata.title);
          if (!record) locale = displayLocale(entry.bundle.metadata.language);
        }
        await this.eraseSession(id, entry);
      }
      if (this.dataDir) {
        // A lesson folder is keyed by the pseudonym of (learner, lesson): look for each lesson the learner
        // may have opened — in their record, completed, on disk now, or named by a folder of the data dir.
        const candidates = new Set([
          ...Object.keys(record?.lessons ?? {}), ...(profile?.completed_lessons ?? []),
          ...catalog.lessons.map((lesson) => lesson.bundle_id), ...lessonFolderNames(this.dataDir),
        ]);
        for (const bundleId of candidates) {
          const scopeDir = durableScopeDir(this.dataDir, await pseudonymOf.get(learnerId, bundleId), bundleId);
          if (!existsSync(scopeDir)) continue;
          await rm(scopeDir, { recursive: true, force: true });
          await removeIfEmpty(dirname(scopeDir));
          lessons.set(bundleId, record?.lessons[bundleId]?.title
            ?? catalog.lessons.find((lesson) => lesson.bundle_id === bundleId)?.title ?? bundleId);
        }
      }
      for (const [bundleId, lesson] of Object.entries(record?.lessons ?? {})) lessons.set(bundleId, lesson.title);
      await this.eraseLearnerRecords(profilePseudonym);
      const erased: ForgetItem[] = [
        ...(lessons.size ? [{ kind: "lesson_progress" as const, lessons: sortedTitles([...lessons.values()]) }] : []),
        ...(profile ? [{ kind: "learner_profile" as const }] : []),
        ...(record ? [{ kind: "study_record" as const }] : []),
      ];
      this.afterForget();
      return this.forgetReport("learner", erased, this.keptOnDisk(catalog), locale);
    });
  }

  /** L-11: a data folder keyed by the legacy secret that no learner holds any more gets its own secret
   * at the next session, in this server too: the legacy secret never keys a learner after a forget
   * emptied the folder. Only once no other session of this server is open (theirs are keyed by it). */
  private afterForget(): void {
    if (this.installSource !== "legacy" || this.dataDir === null || this.registry.size > 0) return;
    if (holdsLearners(this.dataDir)) return;
    this.installSecretValue = undefined;
    this.installSource = undefined;
  }

  /** Erase one live session: its telemetry event, its stores (the engine's erase), its experiment
   * journal and, in durable mode, its whole lesson folder; then drop it. */
  private async eraseSession(id: string, e: SessionEntry): Promise<void> {
    this.experiments.get(id)?.erase();
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
    // L-13: the lesson folder holds only this learner's data for this lesson (mastery claims of earlier
    // sessions, the journal, an emptied log): it goes too, and its pseudonym folder once empty.
    if (e.scopeDir) {
      await rm(e.scopeDir, { recursive: true, force: true });
      await removeIfEmpty(dirname(e.scopeDir));
    }
    e.erased = true;
    this.erasedIds.add(id);
    this.registry.delete(id);
    this.experiments.delete(id);
  }

  /** Erase the learner's profile and study record once the writes already queued for them are done —
   * holding their lock, so no other server's write lands in between (L-11) — and their folder once
   * empty. */
  private async eraseLearnerRecords(profilePseudonym: string): Promise<void> {
    await this.profileStore.delete(profilePseudonym);
    await this.studyStore.delete(profilePseudonym);
    this.statusWriters.delete(profilePseudonym);
    if (this.dataDir) {
      await removeStatusFile(this.dataDir, profilePseudonym);
      await removeIfEmpty(join(this.dataDir, safeSegment(profilePseudonym)));
    }
  }

  /** What forget leaves on disk (L-13): the lessons of the learner's library and the sources they were
   * built from, which the learner may believe gone, and the install's pseudonym key (no learner data). */
  private keptOnDisk(catalog: Catalog): ForgetItem[] {
    const kept: ForgetItem[] = [];
    const library = this.opts.libraryRoot;
    if (library) {
      const titles = catalog.lessons.filter((lesson) => lesson.root === "library").map((lesson) => lesson.title);
      if (titles.length) kept.push({ kind: "library_lessons", lessons: sortedTitles(titles), path: library });
      const sources = join(library, "_sources");
      if (existsSync(sources)) kept.push({ kind: "lesson_sources", path: sources });
      const exports = join(library, EXPORTS_DIR);
      if (existsSync(exports)) kept.push({ kind: "map_exports", path: exports });
    }
    const secret = this.dataDir ? join(this.dataDir, SECRET_FILE) : null;
    if (secret && existsSync(secret)) kept.push({ kind: "pseudonym_key", path: secret });
    return kept;
  }

  private forgetReport(scope: ForgetReport["scope"], erased: ForgetItem[], kept: ForgetItem[], locale: DisplayLocale): ForgetReport {
    return { forgotten: true, scope, erased, kept, display_markdown: forgetMarkdown({ erased, kept }, locale) };
  }

  /** A durable data folder no learner was ever written to: no pseudonym secret yet and no learner
   * folder, where naming a learner's folders would create a secret (pseudonym-secret.ts). Nothing of
   * anyone is there to erase. */
  private holdsNoLearner(): boolean {
    if (this.dataDir === null || envPseudoSecret() !== undefined || this.installSecretValue !== undefined) return false;
    if (existsSync(join(this.dataDir, SECRET_FILE))) return false;
    try { return !readdirSync(this.dataDir, { withFileTypes: true }).some((entry) => entry.isDirectory() && LEARNER_FOLDER.test(entry.name)); }
    catch { return true; } // no data folder yet
  }
}

/** A learner folder of the data dir: a 16-hex pseudonym (HmacPseudonymProvider, pseudonym-secret.ts). */
const LEARNER_FOLDER = /^[0-9a-f]{16}$/;

/** Lesson titles once each, in the reading order of their language. */
function sortedTitles(titles: readonly string[]): string[] {
  return [...new Set(titles)].sort((a, b) => a.localeCompare(b));
}

/** Two lesson sessions of one lesson (any revision): one lesson folder holds what both keep. */
function sameLesson(a: SessionEntry, b: SessionEntry): boolean {
  return a.kind === "lesson" && b.kind === "lesson" && a.bundle.bundle_id === b.bundle.bundle_id;
}

/** The pseudonym folder name of the stores (FileLearnerProfileStore, deps.ts). */
function safeSegment(segment: string): string { return segment.replace(/[^A-Za-z0-9_.-]/g, "_"); }

/** Remove `dir` when it is empty; anything else (absent, not empty) leaves it as it is. */
async function removeIfEmpty(dir: string): Promise<void> {
  try { await rmdir(dir); } catch { /* absent or not empty */ }
}

/** The lesson folder names under every pseudonym folder of the data dir: a lesson the catalog no
 * longer lists may still have a folder there (bundle ids are path-safe in practice). */
function lessonFolderNames(dataDir: string): string[] {
  try {
    return readdirSync(dataDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .flatMap((entry) => readdirSync(join(dataDir, entry.name), { withFileTypes: true })
        .filter((child) => child.isDirectory()).map((child) => child.name));
  } catch { return []; }
}

/** Lower case without accents, for list_lessons' query. */
function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
