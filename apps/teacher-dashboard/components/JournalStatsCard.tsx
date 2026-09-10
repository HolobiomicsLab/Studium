"use client";

import type { JournalStatsResponse } from "@/lib/api";

type Props = { data: JournalStatsResponse };

export default function JournalStatsCard({ data }: Props) {
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="chart-grid" data-testid="journal-stats">
      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card__label">Entries totaux</p>
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
      {Object.keys(data.entries_by_scene).length > 0 && (
        <section className="metric-panel">
          <h3 className="metric-panel__title">Par scène</h3>
          <ul className="data-list">
            {Object.entries(data.entries_by_scene).map(([sid, m]) => (
              <li key={sid} className="data-list__row">
                <code>{sid}</code>
                <span className="data-list__meta">
                  {m.count} entry · {Math.round(m.mean_length)} car. moy.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
