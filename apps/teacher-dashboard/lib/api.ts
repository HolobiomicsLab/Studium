/**
 * API wrapper for analytics-collector.
 *
 * Reads ANALYTICS_BASE_URL from env (default http://localhost:8003).
 * All requests inject the X-Course-Token header (current iteration:
 * the course token must equal the course identifier — ADR validated 2026-05-09).
 */

const BASE = process.env.ANALYTICS_BASE_URL ?? "http://localhost:8003";

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
