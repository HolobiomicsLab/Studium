// packages/lesson-session-host/src/registry.ts
import type { CompanionLog } from "./companion.js";
import type { LessonSession, SessionDeps } from "@studium/lesson-session";
import type { LessonBundle } from "@studium/lesson-bundle-schema";
import type { AuthoringBlock } from "./authoring.js";
import type { ConceptMemoryState } from "./fsrs-memory.js";
import type { ReviewOrigin } from "./review-session.js";
import type { CitedSource } from "./public-scene.js";
import type { LastNavigation } from "./orientation.js";

/** I-2: the passages of a scene answered and not yet left for good, with what settles them. */
export interface HeldSources {
  sceneId: string;
  conceptIds: readonly string[];
  sources: CitedSource[];
}

export interface SessionEntry {
  session: LessonSession;
  deps: SessionDeps;
  bundle: LessonBundle;
  /** dir that relative render-asset paths resolve against (holds lesson.json); "" for a .zip bundle */
  baseDir: string;
  /** per-session cache of inlined text-asset payloads, keyed by resolved path (files are static for
   * the session) — avoids re-reading a big .cube on every get_scene_artifacts turn. */
  assetCache: Map<string, string>;
  /** the LEARNER-level pseudonym (fixed scope, stable across lessons) keying the cross-lesson profile —
   * used to merge this session's concept_states forward on completion. */
  profilePseudonym?: string;
  /** Optional BCP 47 presentation preference. Canonical bundle text and learner input stay unchanged. */
  presentationLanguage?: string;
  /** The ref the session was started with (list_lessons and the study record name lessons by it). */
  bundleRef: string;
  /** sha256 of the lesson.json bytes that were loaded; null for a bundle that is not one file. */
  lessonSha256?: string | null;
  /** Durable mode: the folder holding this learner's data for this lesson (deps.ts durableScopeDir),
   * which forget removes. Absent in memory, and for a review session (it keeps no lesson state). */
  scopeDir?: string;
  /** RFR-06: the learner's minutes a day kept in this lesson's file, recorded in their study record. */
  minutesPerDay?: number;
  /** A lesson, or a review session assembled from the scenes of several lessons (start_review_session). */
  kind: "lesson" | "review";
  /** Who wrote the lesson and its approval record, read once at start (authoring.ts). */
  authoring: AuthoringBlock;
  /** A review session: each scene's lesson, id there and asset folder. */
  reviewOrigins?: Record<string, ReviewOrigin>;
  /** The learner's FSRS memory of this session's concepts (RT-3): the engine's graded answers plus
   * the learner's self-ratings, written through to the profile after each of them. */
  memory: Record<string, ConceptMemoryState>;
  /** The engine's memory as last seen, to tell which concepts an answer just moved. */
  engineMemory: Record<string, ConceptMemoryState>;
  /** Concepts a self-rating moved in this session: their memory is ahead of the engine's. */
  selfRated: Set<string>;
  /** Concepts this session reviewed (an answer or a self-rating). */
  moved: Set<string>;
  /** Responses applied in this session (0 = the first screen). */
  responses: number;
  /** INT-STUDIUM-058: the learner's acts not yet told to the agent (companion.ts). */
  companion?: CompanionLog;
  /** What the concept map already told the learner (host.conceptMapMoment): the concepts whose
   * opening was announced, the scenes shown as a synthesis, and whether a prerequisite detour is
   * under way. Created at the first transition. */
  conceptMapSeen?: { concepts: Set<string>; syntheses: Set<string>; onDetour: boolean };
  /** Each concept state as the session started (JSON): only what the session changed is written back
   * to the profile, so a concept warm-seeded from it never overwrites a newer state with its old copy. */
  conceptStatesAtStart: Readonly<Record<string, string>>;
  /** I-2: the passages of scenes answered and not yet left for good (a retry of the same item, or
   * another item on the same point), released with the answer that leaves that scene or its point. */
  withheldSources: HeldSources[];
  /** L-11: when the session opened, as a step of its host's sequence of opens and forgets (never a
   * clock): a forget of its learner after that closes it, and a session opened later is the learner
   * starting afresh. */
  openedAt: number;
  /** L-11: the data folder's own pseudonym secret this session's folders are keyed by (durable, no
   * STUDIUM_PSEUDO_SECRET): a folder erased or keyed afresh since then is not written back. */
  keyedBy?: string;
  /** L-11: this session read the learner's profile from disk, or wrote it there. A profile it knew and
   * that is gone was erased — by a forget in this server or in another one on the same folder — and
   * the session never writes the learner back. */
  profileSeen: boolean;
  /** Durable forget generation observed when opening, retained even after a new profile appears. */
  learnerTombstone?: string | null;
  /** L-11: the learner's data was erased while this session was open; every later call is refused. */
  erased?: boolean;
  /** The session served its `complete` transition (a rating after it reports the review plan, UX-11). */
  completed?: boolean;
  /** INT-STUDIUM-058: how the session routed after the last response (orientation.ts). In memory only:
   * a session resumed after a restart has none. */
  lastNavigation?: LastNavigation;
  /** INT-STUDIUM-058: on a prerequisite detour, the scene it returns to (orientation.ts). */
  detourReturnsTo?: string;
}

export class SessionRegistry {
  private readonly map = new Map<string, SessionEntry>();
  create(id: string, entry: SessionEntry): void { this.map.set(id, entry); }
  get(id: string): SessionEntry | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
  delete(id: string): boolean { return this.map.delete(id); }
  get size(): number { return this.map.size; }
  /** Every live session, with its id. */
  entries(): Array<[string, SessionEntry]> { return [...this.map.entries()]; }
}
