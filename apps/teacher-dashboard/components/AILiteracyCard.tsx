"use client";

import type { AILiteracyResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";

function colorFor(value: number | null): string {
  if (value === null) return "score-card--muted";
  if (value >= 0.7) return "score-card--strong";
  if (value >= 0.5) return "score-card--watch";
  if (value >= 0.3) return "score-card--low";
  return "score-card--critical";
}

const fmtPct = (n: number | null): string =>
  n === null ? "—" : `${Math.round(n * 100)}%`;

type Props = { pseudonyme: string; data: AILiteracyResponse };

export default function AILiteracyCard({ pseudonyme, data }: Props) {
  const pct = data.value === null ? "—" : `${Math.round(data.value * 100)}%`;
  const icText = data.ic80
    ? `IC80 [${Math.round(data.ic80[0] * 100)}%, ${Math.round(data.ic80[1] * 100)}%]`
    : "IC indispo (<5 sessions)";
  return (
    <figure
      className={`analytics-figure score-card ${colorFor(data.value)}`}
      data-testid="ai-literacy-card"
    >
      <figcaption className="score-card__header">
        <span className="score-card__identity">
          <span className="analytics-figure__title">Littératie IA</span>
          <code>{pseudonyme}</code>
        </span>
        <span className="score-card__value">{pct}</span>
      </figcaption>
      <div className="score-card__body">
        <p className="score-card__meta">
          n={data.n_sessions} sessions · {icText}
        </p>
        {data.degraded && (
          <p className="analytics-note analytics-note--warning">
            Composante manquante (mode dégradé).
          </p>
        )}
        <details>
          <summary>Composantes</summary>
          <ul className="score-card__components">
            <li>
              ai_audit_accuracy : {fmtPct(data.components.ai_audit_accuracy)}
            </li>
            <li>
              hint_independence_trend :{" "}
              {fmtPct(data.components.hint_independence_trend)}
            </li>
            <li>
              critique_completion_rate :{" "}
              {fmtPct(data.components.critique_completion_rate)}
            </li>
          </ul>
        </details>
      </div>
      <p className="score-card__footer">
        Indicateur formatif — non validé pour usage certificatif (ADR 011).
      </p>
      <ChartDataTable
        caption={`Données de littératie IA — ${pseudonyme}`}
        rows={[
          { metric: "Indice de littératie IA", value: fmtPct(data.value) },
          { metric: "Sessions", value: String(data.n_sessions) },
          { metric: "Intervalle de confiance", value: icText },
          {
            metric: "Précision de l’audit IA",
            value: fmtPct(data.components.ai_audit_accuracy),
          },
          {
            metric: "Tendance d’indépendance aux indices",
            value: fmtPct(data.components.hint_independence_trend),
          },
          {
            metric: "Complétion des critiques",
            value: fmtPct(data.components.critique_completion_rate),
          },
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
