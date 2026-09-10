"use client";

import type { ProgressResponse, ProgressMetricsResponse } from "@/lib/api";

type Props = { data: ProgressResponse; metrics?: ProgressMetricsResponse };

function colorFor(rate: number): string {
  if (rate >= 0.8) return "strong";
  if (rate >= 0.6) return "good";
  if (rate >= 0.4) return "watch";
  if (rate >= 0.2) return "low";
  return "critical";
}

export default function ProgressHeatmap({ data, metrics }: Props) {
  const entries = Object.entries(data.scenes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <p className="empty-state">
        Aucun événement <code>scene_completed</code> reçu pour ce cours.
      </p>
    );
  }
  return (
    <section className="chart-panel">
      {metrics?.scenes_with_evidence !== undefined && metrics?.scenes_total !== undefined && (
        <p className="metric-summary">
          Scènes enrichies : <strong>{metrics.scenes_with_evidence}/{metrics.scenes_total}</strong>
        </p>
      )}
      <div className="metric-grid">
        {entries.map(([sceneId, m]) => (
          <div
            key={sceneId}
            className={`progress-cell progress-cell--${colorFor(m.completion_rate)}`}
            data-testid="progress-cell"
          >
            <code className="metric-id">{sceneId}</code>
            <p className="metric-value">{Math.round(m.completion_rate * 100)}%</p>
            <p className="metric-caption">{m.n_learners} apprenant·e·s</p>
          </div>
        ))}
      </div>
      <ul className="legend" aria-label="Légende de progression">
        <li><span className="legend__swatch legend__swatch--strong" />≥80%</li>
        <li><span className="legend__swatch legend__swatch--good" />≥60%</li>
        <li><span className="legend__swatch legend__swatch--watch" />≥40%</li>
        <li><span className="legend__swatch legend__swatch--low" />≥20%</li>
        <li><span className="legend__swatch legend__swatch--critical" />&lt;20%</li>
      </ul>
    </section>
  );
}
