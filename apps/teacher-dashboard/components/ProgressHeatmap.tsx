"use client";

import type { ProgressResponse } from "@/lib/api";

type Props = { data: ProgressResponse };

function colorFor(rate: number): string {
  if (rate >= 0.8) return "bg-emerald-500";
  if (rate >= 0.6) return "bg-emerald-300";
  if (rate >= 0.4) return "bg-amber-300";
  if (rate >= 0.2) return "bg-orange-400";
  return "bg-red-400";
}

export default function ProgressHeatmap({ data }: Props) {
  const entries = Object.entries(data.scenes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <p className="text-gray-500 italic">
        Aucun événement <code>scene_completed</code> reçu pour ce cours.
      </p>
    );
  }
  return (
    <div className="w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {entries.map(([sceneId, m]) => (
          <div
            key={sceneId}
            className={`rounded p-3 text-white ${colorFor(m.completion_rate)}`}
            data-testid="progress-cell"
          >
            <div className="font-mono text-xs opacity-75">{sceneId}</div>
            <div className="text-2xl font-bold">{Math.round(m.completion_rate * 100)}%</div>
            <div className="text-xs">{m.n_learners} apprenant·e·s</div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-xs text-gray-500 flex gap-3">
        <span>≥80% vert foncé</span>
        <span>≥60% vert clair</span>
        <span>≥40% ambre</span>
        <span>≥20% orange</span>
        <span>&lt;20% rouge</span>
      </div>
    </div>
  );
}
