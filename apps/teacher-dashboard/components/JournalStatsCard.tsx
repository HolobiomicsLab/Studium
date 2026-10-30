"use client";

import type { JournalStatsResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";

type Props = { data: JournalStatsResponse; sceneTitles?: Record<string, string> };

export default function JournalStatsCard({ data, sceneTitles = {} }: Props) {
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
  const sceneEntries = Object.entries(data.entries_by_scene);
  const tableRows = [
    { metric: "Entrées totales", scope: "Cours", value: String(data.entries_total) },
    { metric: "Longueur moyenne", scope: "Cours", value: `${Math.round(data.mean_length)} caractères` },
    { metric: "Taux de révision", scope: "Cours", value: fmtPct(data.revision_rate) },
    ...sceneEntries.flatMap(([sceneId, metric]) => {
      const scene = sceneTitles[sceneId] ?? sceneId;
      return [
        { metric: "Entrées", scope: scene, value: String(metric.count) },
        { metric: "Longueur moyenne", scope: scene, value: `${Math.round(metric.mean_length)} caractères` },
      ];
    }),
  ];
  return (
    <figure className="analytics-figure chart-grid" data-testid="journal-stats">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Journal réflexif</span>
        <span className="analytics-figure__description">
          Volume, longueur et révision des entrées, sans exposer leur texte.
        </span>
      </figcaption>
      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card__label">Entrées totales</p>
          <p className="stat-card__value">{data.entries_total}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Longueur moyenne</p>
          <p className="stat-card__value">{Math.round(data.mean_length)} car.</p>
        </div>
        <div className="stat-card">
          <p className="stat-card__label">Taux de révision</p>
          <p className="stat-card__value">{fmtPct(data.revision_rate)}</p>
        </div>
      </div>
      {sceneEntries.length > 0 && (
        <section className="metric-panel">
          <h3 className="metric-panel__title">Par scène</h3>
          <ul className="data-list">
            {sceneEntries.map(([sid, m]) => (
              <li key={sid} className="data-list__row">
                <span className="data-list__identity">
                  <span>{sceneTitles[sid] ?? sid}</span>
                  {sceneTitles[sid] ? <code>{sid}</code> : null}
                </span>
                <span className="data-list__meta">
                  {m.count} entrée{m.count > 1 ? "s" : ""} · {Math.round(m.mean_length)} car. moy.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ChartDataTable
        caption="Données agrégées du journal réflexif"
        rows={tableRows}
        rowKey={(row, index) => `${row.scope}-${row.metric}-${index}`}
        columns={[
          { key: "scope", label: "Portée", rowHeader: true, render: (row) => row.scope },
          { key: "metric", label: "Mesure", render: (row) => row.metric },
          { key: "value", label: "Valeur", render: (row) => row.value },
        ]}
      />
    </figure>
  );
}
