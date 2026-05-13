"use client";

import type { JournalStatsResponse } from "@/lib/api";

type Props = { data: JournalStatsResponse };

export default function JournalStatsCard({ data }: Props) {
  const fmtPct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="space-y-4" data-testid="journal-stats">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white shadow rounded p-4">
          <p className="text-xs text-gray-500">Entries totaux</p>
          <p className="text-2xl font-bold">{data.entries_total}</p>
        </div>
        <div className="bg-white shadow rounded p-4">
          <p className="text-xs text-gray-500">Longueur moyenne</p>
          <p className="text-2xl font-bold">{Math.round(data.mean_length)} car.</p>
        </div>
        <div className="bg-white shadow rounded p-4">
          <p className="text-xs text-gray-500">Taux de révision</p>
          <p className="text-2xl font-bold">{fmtPct(data.revision_rate)}</p>
        </div>
      </div>
      {Object.keys(data.entries_by_scene).length > 0 && (
        <div className="bg-white shadow rounded p-4">
          <h3 className="text-sm font-semibold mb-2">Par scène</h3>
          <ul className="space-y-1 text-sm">
            {Object.entries(data.entries_by_scene).map(([sid, m]) => (
              <li key={sid} className="flex justify-between">
                <code className="text-xs">{sid}</code>
                <span>
                  {m.count} entry · {Math.round(m.mean_length)} car. moy.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
