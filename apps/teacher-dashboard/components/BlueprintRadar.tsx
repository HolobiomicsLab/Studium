"use client";

import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { BlueprintScoreResponse } from "@/lib/api";

type Props = { data: BlueprintScoreResponse };

export default function BlueprintRadar({ data }: Props) {
  const chartData = data.dimensions.map((d) => ({
    dimension: d.label,
    score: d.score ?? 0,
    degraded: d.degraded,
  }));
  if (chartData.length === 0) {
    return (
      <p className="text-gray-500 italic">
        Aucune dimension à afficher (blueprint vide).
      </p>
    );
  }
  return (
    <div data-testid="blueprint-radar">
      <div className="w-full h-96">
        <ResponsiveContainer>
          <RadarChart data={chartData}>
            <PolarGrid />
            <PolarAngleAxis dataKey="dimension" />
            <PolarRadiusAxis domain={[0, 1]} />
            <Radar dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.4} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-4 text-center text-xl font-bold">
        Score global : {data.overall_weighted_score === null
          ? "—"
          : `${Math.round(data.overall_weighted_score * 100)}%`}
      </p>
      {chartData.some((d) => d.degraded) && (
        <p className="text-center text-xs italic text-gray-500 mt-1">
          ⚠ Au moins une dimension est en mode dégradé (composante manquante)
        </p>
      )}
    </div>
  );
}
