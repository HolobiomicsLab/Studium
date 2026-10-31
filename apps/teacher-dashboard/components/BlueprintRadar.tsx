"use client";

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { BlueprintScoreResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";
import { CHART_SERIES } from "@/lib/chart-palette";

type Props = { data: BlueprintScoreResponse };

export default function BlueprintRadar({ data }: Props) {
  const chartData = data.dimensions.map((d) => ({
    dimension: d.label,
    score: d.score,
    degraded: d.degraded,
  }));
  if (chartData.length === 0) {
    return (
      <p className="empty-state">
        Aucune dimension à afficher (blueprint vide).
      </p>
    );
  }
  return (
    <figure className="analytics-figure metric-panel" data-testid="blueprint-radar">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Profil du blueprint</span>
        <span className="analytics-figure__description">
          Scores par dimension, de 0 à 100 %. Une valeur manquante reste affichée « — ».
        </span>
      </figcaption>
      <div className="chart-frame chart-frame--tall" aria-hidden="true">
        <ResponsiveContainer>
          <RadarChart data={chartData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dimension" />
            <PolarRadiusAxis domain={[0, 1]} />
            <Radar
              dataKey="score"
              stroke={CHART_SERIES[0]!.stroke}
              fill={CHART_SERIES[0]!.stroke}
              fillOpacity={0.28}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="blueprint-score">
        Score global : {data.overall_weighted_score === null
          ? "—"
          : `${Math.round(data.overall_weighted_score * 100)}%`}
      </p>
      {chartData.some((d) => d.degraded) && (
        <p className="analytics-note analytics-note--warning">
          Au moins une dimension est en mode dégradé (composante manquante).
        </p>
      )}
      <ChartDataTable
        caption="Données du blueprint par dimension"
        rows={chartData}
        rowKey={(row) => row.dimension}
        columns={[
          {
            key: "dimension",
            label: "Dimension",
            rowHeader: true,
            render: (row) => row.dimension,
          },
          {
            key: "score",
            label: "Score",
            render: (row) => row.score === null ? "—" : `${Math.round(row.score * 100)} %`,
          },
          {
            key: "quality",
            label: "État",
            render: (row) => row.degraded ? "Mode dégradé" : "Complet",
          },
        ]}
      />
    </figure>
  );
}
