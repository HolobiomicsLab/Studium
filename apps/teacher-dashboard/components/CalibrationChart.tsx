"use client";

import type { CalibrationResponse } from "@/lib/api";
import CohortLine from "./CohortLine";

// No `learner` prop — see TrustCalibrationChart (INT-STUDIUM-030).
type Props = { data: CalibrationResponse };

function qualifyBrier(b: number | null): { label: string; color: string } {
  if (b === null) return { label: "Données insuffisantes", color: "text-gray-500" };
  if (b < 0.1) return { label: "Excellente calibration", color: "text-emerald-700" };
  if (b < 0.2) return { label: "Bonne calibration", color: "text-emerald-600" };
  if (b < 0.3) return { label: "Calibration correcte", color: "text-amber-600" };
  return { label: "Calibration faible — surévaluation possible", color: "text-red-600" };
}

export default function CalibrationChart({ data }: Props) {
  const q = qualifyBrier(data.brier_score);
  return (
    <div className="space-y-3" data-testid="calibration-chart">
      <h3 className="font-semibold">
        Calibration agrégée
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
      {/* INT-STUDIUM-030 R1: the line above counts ANSWERS, which is not a population. Two
          hundred answers can be four learners. The number is only interpretable once the
          reader knows who it was computed over, so that comes from the payload rather than
          from a count the panel happens to have. */}
      <CohortLine judgement={data.judgement} />
    </div>
  );
}
