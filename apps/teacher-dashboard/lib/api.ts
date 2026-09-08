/**
 * API wrapper for analytics-collector.
 *
 * Reads ANALYTICS_BASE_URL from env (default http://localhost:8003).
 * All requests inject the X-Course-Token header (current iteration:
 * the course token must equal the course identifier — ADR validated 2026-05-09).
 */

const BASE = process.env.ANALYTICS_BASE_URL ?? "http://localhost:8003";

// scene-synth hosts the learner-as-author moderation endpoints. This is the
// dashboard's FIRST write path + first call to a service other than
// analytics-collector. CORS on scene-synth must allow this app's origin
// (http://localhost:3001) — see services/scene-synth/scene_synth_app.py.
const SCENE_SYNTH_BASE =
  process.env.SCENE_SYNTH_BASE_URL ?? "http://localhost:8002";

// lesson-server hosts the PeerStudio Room endpoints.
const LESSON_SERVER_BASE =
  process.env.LESSON_SERVER_BASE_URL ?? "http://localhost:8010";

export type ProgressResponse = {
  scenes: Record<string, { completion_rate: number; n_learners: number }>;
};

export type ProgressMetricsResponse = {
  scenes_with_evidence?: number;
  scenes_total?: number;
};

export type CalibrationResponse = {
  brier_score: number | null;
  n_items: number;
};

export type AutonomyResponse = {
  critique_completion_rate: number;
  autonomy_ratio: number;
  n_critique: number;
  n_hints: number;
};

// trust_calibration (judgment-over-artifact) — distinct from CalibrationResponse
// (declared-vs-competence Brier). Surface of the engine's `trust_calibration`
// dimension over grounded spot_the_flaw audits. band: "sur" = over-trust
// (surconfiance IA), "sous" = over-distrust (méfiance IA), "bien" = within band.
export type TrustCalibrationResponse = {
  trust_calibration: number | null;
  band: "bien" | "sur" | "sous" | null;
  n_audits: number;
  over_trust: number | null;
  over_distrust: number | null;
  per_scene: Array<{
    scene_id: string;
    gap: number | null;
    over_trust: number | null;
    over_distrust: number | null;
    planted_errors: number;
    missed: number;
    false_positives: number;
  }>;
};

/**
 * What every class-level endpoint may return INSTEAD of its numbers (INT-STUDIUM-005).
 *
 * The collector applies the k-anonymity floor per lesson before it serves an aggregate, so a
 * cohort below the floor produces this shape where a chart's data used to be. It states the
 * floor and never the cohort — publishing the count would name exactly the classes the floor
 * exists to protect (INT-STUDIUM-030).
 */
export type Suppressed = {
  status: "suppressed";
  min_learners: number;
  reason: string;
};

/** Narrow a metrics response before handing it to a chart. */
export function isSuppressed(data: unknown): data is Suppressed {
  return (
    typeof data === "object" && data !== null &&
    (data as { status?: unknown }).status === "suppressed"
  );
}

/**
 * A surface the collector has WITHDRAWN, for every cohort (INT-STUDIUM-030).
 *
 * Distinct from `Suppressed`, which is this class being too small today and would serve
 * numbers tomorrow. `unavailable` says the route publishes nothing at all, and the `reason`
 * says why — rendering the two the same way would tell a teacher their class is too small
 * when the truth is that the instrument was never wired.
 */
export type Unavailable = {
  status: "unavailable";
  reason: string;
};

export function isUnavailable(data: unknown): data is Unavailable {
  return (
    typeof data === "object" && data !== null &&
    (data as { status?: unknown }).status === "unavailable"
  );
}

async function fetchJson<T>(path: string, courseToken: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "X-Course-Token": courseToken },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`Analytics API ${path} failed: ${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<T>;
}

export function getProgress(courseToken: string): Promise<ProgressResponse | Suppressed> {
  return fetchJson<ProgressResponse | Suppressed>(
    `/metrics/progress?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export function getProgressMetrics(courseToken: string): Promise<ProgressMetricsResponse | Suppressed> {
  return fetchJson<ProgressMetricsResponse | Suppressed>(
    `/metrics/progress-metrics?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

// INT-STUDIUM-030: the `learner` / `pseudonyme` arguments are gone from every class-level
// helper below. No Studium surface exposes a control that narrows a published aggregate to a
// caller-chosen subset of the cohort — a floor with a drill-down behind it is not a floor.
// The two individual reads an ADR authorises (getAILiteracy, postBlueprintScore) still take a
// pseudonym, and it is REQUIRED there rather than optional, which is the whole distinction.
export function getCalibration(
  courseToken: string,
): Promise<CalibrationResponse | Suppressed> {
  return fetchJson<CalibrationResponse | Suppressed>(
    `/metrics/calibration?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export function getAutonomy(courseToken: string): Promise<AutonomyResponse | Suppressed> {
  return fetchJson<AutonomyResponse | Suppressed>(
    `/metrics/autonomy?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export function getTrustCalibration(
  courseToken: string,
): Promise<TrustCalibrationResponse | Suppressed> {
  return fetchJson<TrustCalibrationResponse | Suppressed>(
    `/metrics/trust-calibration?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

// Class-level course-spine funnel: distinct completers per lesson_id. Overlaid on
// the CourseManifest (order + prerequisites). Per-lesson distinct counts only —
// NOT per-individual cross-lesson tracking (telemetry pseudonyms are bundle-scoped).
export type CourseCompletionResponse = {
  lessons: Record<string, { n_completed: number }>;
  total_completions: number;
};

export function getCourseCompletion(courseToken: string): Promise<CourseCompletionResponse | Suppressed> {
  return fetchJson<CourseCompletionResponse | Suppressed>(
    `/metrics/course-completion?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export type MasteryPoint = {
  date: string;
  pseudonyme: string;
  alpha: number;
  beta: number;
  mastery: number;
  n_attempts: number;
};

export type ConceptMasteryHistoryResponse = {
  concepts: Record<string, MasteryPoint[]>;
};

/**
 * Withdrawn at the collector (INT-STUDIUM-030): the rows are keyed by pseudonym, so no
 * parameter list makes this route class-level, and the snapshots behind it were never written.
 * The helper stays so the page has something to render the refusal from — see `Unavailable`.
 */
export function getConceptMasteryHistory(
  courseToken: string,
  opts: { concept_id?: string; since?: string } = {},
): Promise<ConceptMasteryHistoryResponse | Suppressed | Unavailable> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.concept_id) params.set("concept_id", opts.concept_id);
  if (opts.since) params.set("since", opts.since);
  return fetchJson<ConceptMasteryHistoryResponse | Suppressed | Unavailable>(
    `/metrics/concept-mastery-history?${params.toString()}`,
    courseToken,
  );
}

export type AILiteracyResponse = {
  value: number | null;
  ic80: [number, number] | null;
  n_sessions: number;
  window: number;
  degraded: boolean;
  components: {
    ai_audit_accuracy: number | null;
    hint_independence_trend: number | null;
    critique_completion_rate: number | null;
  };
};

export function getAILiteracy(
  courseToken: string,
  pseudonyme: string,
  window = 10,
): Promise<AILiteracyResponse> {
  const params = new URLSearchParams({
    course: courseToken,
    pseudonyme,
    window: window.toString(),
  });
  return fetchJson<AILiteracyResponse>(
    `/metrics/ai-literacy?${params.toString()}`,
    courseToken,
  );
}

export type ReasoningSceneEntry = {
  score: number | null;
  n_signals: number;
  breakdown: Record<string, number>;
};
export type ReasoningResponse = { scenes: Record<string, ReasoningSceneEntry> };

// `scene_id` survives the INT-STUDIUM-030 removal: a scene is an artifact scope, not a person.
export function getReasoningDepth(
  courseToken: string,
  opts: { scene_id?: string } = {},
): Promise<ReasoningResponse | Suppressed> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.scene_id) params.set("scene_id", opts.scene_id);
  return fetchJson<ReasoningResponse | Suppressed>(
    `/metrics/reasoning?${params.toString()}`,
    courseToken,
  );
}

export type JournalStatsResponse = {
  entries_total: number;
  mean_length: number;
  revision_rate: number;
  entries_by_scene: Record<string, { count: number; mean_length: number }>;
};

export function getJournalStats(
  courseToken: string,
  opts: { bundle_version?: string } = {},
): Promise<JournalStatsResponse | Suppressed> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.bundle_version) params.set("bundle_version", opts.bundle_version);
  return fetchJson<JournalStatsResponse | Suppressed>(
    `/metrics/journal?${params.toString()}`,
    courseToken,
  );
}

export type CooperationStatsResponse = {
  n_sessions: number;
  convergence_quality: number | null;
  role_coverage_mean: number | null;
  disagreement_productive_ratio: number | null;
  votes_per_session_mean: number;
};

export function getCooperationStats(
  courseToken: string,
  opts: { bundle_version?: string } = {},
): Promise<CooperationStatsResponse | Suppressed> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.bundle_version) params.set("bundle_version", opts.bundle_version);
  return fetchJson<CooperationStatsResponse | Suppressed>(
    `/metrics/cooperation?${params.toString()}`,
    courseToken,
  );
}

export type BlueprintScoreResponse = {
  dimensions: Array<{ id: string; label: string; score: number | null; degraded: boolean }>;
  overall_weighted_score: number | null;
};

export type AssessmentBlueprintInput = {
  dimensions: Array<{
    id: string;
    label: string;
    weight: number;
    metrics: Array<{
      endpoint: "progress" | "calibration" | "autonomy" | "ai_literacy" | "reasoning" | "ai_audit";
      field: string;
      weight_in_dimension: number;
    }>;
  }>;
};

export async function postBlueprintScore(
  courseToken: string,
  pseudonyme: string,
  blueprint: AssessmentBlueprintInput,
  bundle_version?: string,
): Promise<BlueprintScoreResponse> {
  const r = await fetch(`${BASE}/metrics/blueprint`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Course-Token": courseToken,
    },
    body: JSON.stringify({
      course: courseToken,
      pseudonyme,
      bundle_version: bundle_version ?? null,
      blueprint,
    }),
  });
  if (!r.ok) {
    throw new Error(`Analytics API /metrics/blueprint failed: ${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<BlueprintScoreResponse>;
}

// ---------------------------------------------------------------------------
// Learner-as-author moderation queue (scene-synth :8002).
//
// These are the dashboard's first WRITE calls and its first calls to
// scene-synth. The teacher lists `submitted` items, sees each scene body + its
// answer key + the validation badge + a de-identified author tag, and decides.
//
// SAFETY: the LearnerItemView returned by scene-synth NEVER carries
// author_pseudonym (it is server-only, scrubbed from the client projection).
// The dashboard only ever calls /decide — it cannot fabricate any other
// review_state. Surfacing/publishing happens server-side in decide_item().
// ---------------------------------------------------------------------------

export type LAReviewState =
  | "submitted"
  | "peer_review"
  | "revision_requested"
  | "approved"
  | "published"
  | "rejected";

export type LAReviewNoteCode =
  | "factual_error"
  | "ambiguous_distractor"
  | "off_topic"
  | "ok";

export type LADecision = "approve" | "reject" | "request_revision";

export type LAChoice = { id: string; text: string; correct: boolean };

/**
 * A learner-authored quiz scene (schema-pure QuizScene). The dashboard renders
 * the FULL body — including `correct` flags (the answer key) — so a teacher
 * never approves blind. Other scene types carry their own answer-key fields;
 * `Record<string, unknown>` keeps the queue forward-compatible while the demo
 * course is quiz-only.
 */
export type LAScene = {
  id: string;
  type: string;
  title: string;
  question?: string;
  choices?: LAChoice[];
  feedback_correct?: string;
  feedback_incorrect?: string;
  hints?: string[];
  [k: string]: unknown;
};

export type LAValidationView = {
  ok: boolean;
  validator_version: string;
  errors: string[];
};

/** Client-safe projection returned by scene-synth — NO author_pseudonym. */
export type LearnerItemView = {
  item_id: string;
  course_id: string;
  target_bundle_ref: string;
  schema_version: string;
  scene: LAScene;
  review_state: LAReviewState;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note_code?: LAReviewNoteCode | null;
  validation: LAValidationView;
  created_at: string;
  published_bundle_ref?: string | null;
};

export type LearnerItemsListResponse = { items: LearnerItemView[] };

/**
 * GET /learner-items?course=&state= on scene-synth. Lists learner-authored
 * items for moderation. Injects X-Course-Token (same convention as analytics).
 */
export async function getLearnerItems(
  courseToken: string,
  state: LAReviewState = "submitted",
): Promise<LearnerItemsListResponse> {
  const params = new URLSearchParams({ course: courseToken, state });
  const r = await fetch(`${SCENE_SYNTH_BASE}/learner-items?${params.toString()}`, {
    headers: { "X-Course-Token": courseToken },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`scene-synth /learner-items failed: ${r.status} ${r.statusText}`);
  }
  return r.json() as Promise<LearnerItemsListResponse>;
}

export type DecideLearnerItemArgs = {
  decision: LADecision;
  reviewer: string; // teacher IRI (course-token-derived); non-empty
  reviewed_at: string; // explicit ISO-Z timestamp; never now() server-side
  note_code?: LAReviewNoteCode;
};

/**
 * POST /learner-items/{id}/decide on scene-synth. The dashboard's SOLE publish
 * path (rule 003): approve here triggers server-side surfacing. reviewer and
 * reviewed_at are sent explicitly — scene-synth rejects an empty reviewer / an
 * empty timestamp-on-approve with a 4xx.
 */
export async function decideLearnerItem(
  courseToken: string,
  itemId: string,
  args: DecideLearnerItemArgs,
): Promise<LearnerItemView> {
  const body: Record<string, unknown> = {
    decision: args.decision,
    reviewer: args.reviewer,
    reviewed_at: args.reviewed_at,
  };
  if (args.note_code) body.note_code = args.note_code;
  const r = await fetch(
    `${SCENE_SYNTH_BASE}/learner-items/${encodeURIComponent(itemId)}/decide`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Course-Token": courseToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    throw new Error(
      `scene-synth /learner-items/${itemId}/decide failed: ${r.status} ${r.statusText}`,
    );
  }
  return r.json() as Promise<LearnerItemView>;
}

/**
 * Derive a stable teacher IRI from the course token (matches the backend's
 * course-token-derived reviewer convention). Used as the `reviewer` field.
 */
export function teacherIriForToken(courseToken: string): string {
  return `urn:studium:teacher:${encodeURIComponent(courseToken)}`;
}

// ---------------------------------------------------------------------------
// PeerStudio Room API (lesson-server :8010)
// ---------------------------------------------------------------------------

export type TargetAggregate = {
  target_session_id: string;
  k: number;
  passed_rate: number;
  avg_rating: number;
  avg_helpful: number;
};

export type RoomState = {
  room_id: string;
  bundle_ref: string;
  session_count: number;
  rating_count: number;
  closed: boolean;
  aggregates: TargetAggregate[];
};

async function roomFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${LESSON_SERVER_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
    cache: "no-store",
  });
  const json = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`lesson-server ${path} failed: ${r.status} — ${String(json["error"] ?? json["message"] ?? "")}`);
  return json as T;
}

export async function openRoom(bundleRef: string): Promise<{ room_id: string; join_code: string; teacher_key: string }> {
  return roomFetch("/rooms", { method: "POST", body: JSON.stringify({ bundle_ref: bundleRef }) });
}

export async function joinRoom(joinCode: string, sessionId: string): Promise<{ room_id: string; session_count: number }> {
  return roomFetch("/rooms/join", { method: "POST", body: JSON.stringify({ join_code: joinCode, session_id: sessionId }) });
}

export async function getRoomState(roomId: string, teacherKey: string): Promise<RoomState> {
  return roomFetch(`/rooms/${roomId}?teacher_key=${encodeURIComponent(teacherKey)}`);
}

export async function closeRoom(roomId: string, teacherKey: string): Promise<RoomState> {
  return roomFetch(`/rooms/${roomId}/close`, { method: "POST", body: JSON.stringify({ teacher_key: teacherKey }) });
}

// ---------------------------------------------------------------------------
// Course spine manifest (lesson-server :8010) — the lesson DAG the dashboard
// overlays on analytics completion counts. Mirrors CourseSchema.
// ---------------------------------------------------------------------------

export type CourseManifestLesson = {
  lesson_id: string;
  bundle_ref: string;
  title?: string;
  prerequisite_lesson_ids: string[];
};

export type CourseManifest = {
  schema_version: string;
  course_id: string;
  title: string;
  lessons: CourseManifestLesson[];
};

/** GET /courses?ref= on lesson-server. `ref` is a manifest path under the
 * server's bundlesRoot (e.g. "courses/decay-course.json"). */
export async function getCourse(ref: string): Promise<CourseManifest> {
  const r = await roomFetch<{ course: CourseManifest }>(`/courses?ref=${encodeURIComponent(ref)}`);
  return r.course;
}
