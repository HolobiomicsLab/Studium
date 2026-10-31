"use client";

import type { CalibrationResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";
import CohortLine from "./CohortLine";

// No `learner` prop — see TrustCalibrationChart (INT-STUDIUM-030).
type Props = { data: CalibrationResponse };

function qualifyBrier(b: number | null): { label: string; tone: string } {
  if (b === null) return { label: "Données insuffisantes", tone: "muted" };
  if (b < 0.1) return { label: "Excellente calibration", tone: "strong" };
  if (b < 0.2) return { label: "Bonne calibration", tone: "strong" };
  if (b < 0.3) return { label: "Calibration correcte", tone: "watch" };
  return { label: "Calibration faible — surévaluation possible", tone: "low" };
}

export default function CalibrationChart({ data }: Props) {
  const q = qualifyBrier(data.brier_score);
  return (
    <figure className="analytics-figure metric-panel" data-testid="calibration-chart">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Calibration agrégée</span>
        <span className="analytics-figure__description">
          Concordance entre la confiance déclarée et les réponses observées.
        </span>
      </figcaption>
      <div className="metric-panel__reading">
        <span className="metric-panel__value">
          {data.brier_score !== null ? data.brier_score.toFixed(3) : "—"}
        </span>
        <span className="metric-panel__unit">Brier score</span>
      </div>
      <p className={`metric-panel__verdict metric-panel__verdict--${q.tone}`}>
        {q.label}
      </p>
      <p className="metric-panel__definition">
        Calculé sur {data.n_items} réponse{data.n_items > 1 ? "s" : ""} de quiz.
        Brier = mean((confidence - outcome)²) ; plus bas = mieux calibré.
      </p>
      {/* INT-STUDIUM-030 R1: the line above counts ANSWERS, which is not a population. Two
          hundred answers can be four learners. The number is only interpretable once the
          reader knows who it was computed over, so that comes from the payload rather than
          from a count the panel happens to have. */}
      <CohortLine judgement={data.judgement} />
      <ChartDataTable
        caption="Données de calibration agrégée"
        rows={[
          { metric: "Brier score", value: data.brier_score === null ? "—" : data.brier_score.toFixed(3) },
          { metric: "Réponses de quiz", value: String(data.n_items) },
          { metric: "Interprétation", value: q.label },
          { metric: "Bande de cohorte", value: data.judgement.cohort_band ?? "—" },
        ]}
        rowKey={(row) => row.metric}
        columns={[
          { key: "metric", label: "Mesure", rowHeader: true, render: (row) => row.metric },
          { key: "value", label: "Valeur", render: (row) => row.value },
        ]}
      />
    </figure>
  );
}
