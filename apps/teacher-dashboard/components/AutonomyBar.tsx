"use client";

import type { AutonomyResponse } from "@/lib/api";

type Props = { data: AutonomyResponse };

export default function AutonomyBar({ data }: Props) {
  const ratioPct = Math.round(data.autonomy_ratio * 100);
  const completionPct = Math.round(data.critique_completion_rate * 100);
  const total = data.n_critique + data.n_hints;
  return (
    <div className="space-y-4" data-testid="autonomy-bar">
      <div>
        <div className="flex justify-between text-sm mb-1">
          {/* INT-STUDIUM-023: this is the collector's course-level ratio of events
              (metrics.AUTONOMY_INDICATOR_NAME). The runtime computes a different ratio
              under the same wire key `autonomy_ratio` — scenes completed over scenes plus
              scaffolding, per session — which the class report publishes as "mean
              scaffolding independence". Neither key is renamed; the names differ so the
              two numbers are not read as one. */}
          <span>Équilibre critique / indice</span>
          <span className="font-mono">{ratioPct}%</span>
        </div>
        <div className="h-3 bg-gray-200 rounded overflow-hidden">
          <div
            className={`h-full ${ratioPct >= 60 ? "bg-emerald-500" : ratioPct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${ratioPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {data.n_critique} critique{data.n_critique > 1 ? "s" : ""} soumise
          {data.n_critique > 1 ? "s" : ""} sur {total} interactions adaptatives
          (critique + hint).
        </p>
      </div>
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span>Taux de complétion des critiques</span>
          <span className="font-mono">{completionPct}%</span>
        </div>
        <div className="h-3 bg-gray-200 rounded overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${completionPct}%` }} />
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Anti-offloading : plus l&apos;équilibre critique / indice est élevé, plus les
        apprenant·e·s engagent une critique réflexive plutôt que de demander un indice.
      </p>
      <p className="text-xs text-gray-500">
        Mesure de classe, sur les événements de ce cours. À ne pas confondre avec
        l&apos;<i>indépendance vis-à-vis de l&apos;étayage</i> du rapport de classe, calculée
        par session sur l&apos;appareil (scènes terminées / scènes + étayage) : deux mesures
        différentes transmises sous la même clé <code>autonomy_ratio</code>.
      </p>
    </div>
  );
}
