"use client";

import type { CalibrationResponse } from "@/lib/api";

type Props = { data: CalibrationResponse; learner?: string };

function qualifyBrier(b: number | null): { label: string; color: string } {
  if (b === null) return { label: "Données insuffisantes", color: "text-gray-500" };
  if (b < 0.1) return { label: "Excellente calibration", color: "text-emerald-700" };
  if (b < 0.2) return { label: "Bonne calibration", color: "text-emerald-600" };
  if (b < 0.3) return { label: "Calibration correcte", color: "text-amber-600" };
  return { label: "Calibration faible — surévaluation possible", color: "text-red-600" };
}

export default function CalibrationChart({ data, learner }: Props) {
  const q = qualifyBrier(data.brier_score);
  return (
    <div className="space-y-3" data-testid="calibration-chart">
      <h3 className="font-semibold">
        {learner ? `Calibration de ${learner}` : "Calibration agrégée"}
      </h3>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums">
          {data.brier_score !== null ? data.brier_score.toFixed(3) : "—"}
        </span>
        <span className="text-sm text-gray-500">Brier score</span>
      </div>
      <p className={`font-medium ${q.color}`}>{q.label}</p>
      <p className="text-xs text-gray-500">
        Calculé sur {data.n_items} réponse{data.n_items > 1 ? "s" : ""} de quiz.
        Brier = mean((confidence - outcome)²) ; plus bas = mieux calibré.
      </p>
    </div>
  );
}
