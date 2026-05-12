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
