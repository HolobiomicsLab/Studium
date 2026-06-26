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

export function getProgress(courseToken: string): Promise<ProgressResponse> {
  return fetchJson<ProgressResponse>(
    `/metrics/progress?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export function getProgressMetrics(courseToken: string): Promise<ProgressMetricsResponse> {
  return fetchJson<ProgressMetricsResponse>(
    `/metrics/progress-metrics?course=${encodeURIComponent(courseToken)}`,
    courseToken,
  );
}

export function getCalibration(
  courseToken: string,
  learner?: string,
): Promise<CalibrationResponse> {
  const learnerParam = learner ? `&learner=${encodeURIComponent(learner)}` : "";
  return fetchJson<CalibrationResponse>(
    `/metrics/calibration?course=${encodeURIComponent(courseToken)}${learnerParam}`,
    courseToken,
  );
}

export function getAutonomy(courseToken: string): Promise<AutonomyResponse> {
  return fetchJson<AutonomyResponse>(
    `/metrics/autonomy?course=${encodeURIComponent(courseToken)}`,
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

export function getConceptMasteryHistory(
  courseToken: string,
  opts: { pseudonyme?: string; concept_id?: string; since?: string } = {},
): Promise<ConceptMasteryHistoryResponse> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.pseudonyme) params.set("pseudonyme", opts.pseudonyme);
  if (opts.concept_id) params.set("concept_id", opts.concept_id);
  if (opts.since) params.set("since", opts.since);
  return fetchJson<ConceptMasteryHistoryResponse>(
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

export function getReasoningDepth(
  courseToken: string,
  opts: { pseudonyme?: string; scene_id?: string } = {},
): Promise<ReasoningResponse> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.pseudonyme) params.set("pseudonyme", opts.pseudonyme);
  if (opts.scene_id) params.set("scene_id", opts.scene_id);
  return fetchJson<ReasoningResponse>(
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
  opts: { pseudonyme?: string; bundle_version?: string } = {},
): Promise<JournalStatsResponse> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.pseudonyme) params.set("pseudonyme", opts.pseudonyme);
  if (opts.bundle_version) params.set("bundle_version", opts.bundle_version);
  return fetchJson<JournalStatsResponse>(
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
): Promise<CooperationStatsResponse> {
  const params = new URLSearchParams({ course: courseToken });
  if (opts.bundle_version) params.set("bundle_version", opts.bundle_version);
  return fetchJson<CooperationStatsResponse>(
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
