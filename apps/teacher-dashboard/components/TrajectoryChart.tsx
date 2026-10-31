"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { ConceptMasteryHistoryResponse } from "@/lib/api";
import { chartSeriesStyle } from "@/lib/chart-palette";
import ChartDataTable, { type ChartDataColumn } from "./ChartDataTable";

type Props = {
  data: ConceptMasteryHistoryResponse;
  selectedConcepts?: string[];
  conceptTitles?: Record<string, string>;
};

export default function TrajectoryChart({
  data,
  selectedConcepts,
  conceptTitles = {},
}: Props) {
  const concepts = Object.keys(data.concepts);
  const visible = selectedConcepts && selectedConcepts.length > 0
    ? concepts.filter((c) => selectedConcepts.includes(c)).slice(0, 5)
    : concepts.slice(0, 5);

  if (visible.length === 0) {
    return (
      <p className="empty-state">
        Aucune donnée de maîtrise reçue pour ce cours.
      </p>
    );
  }

  const allDates = new Set<string>();
  for (const cid of visible) {
    for (const pt of data.concepts[cid] ?? []) allDates.add(pt.date);
  }
  const sortedDates = Array.from(allDates).sort();
  const chartData = sortedDates.map((d) => {
    const row: Record<string, number | string> = { date: d };
    for (const cid of visible) {
      const pt = (data.concepts[cid] ?? []).find((p) => p.date === d);
      if (pt) row[cid] = pt.mastery;
    }
    return row;
  });
  const tableColumns: ChartDataColumn<Record<string, number | string>>[] = [
    {
      key: "date",
      label: "Date",
      rowHeader: true,
      render: (row) => row.date,
    },
    ...visible.map((conceptId) => ({
      key: conceptId,
      label: conceptTitles[conceptId] ?? conceptId,
      render: (row: Record<string, number | string>) =>
        typeof row[conceptId] === "number"
          ? `${Math.round((row[conceptId] as number) * 100)} %`
          : "—",
    })),
  ];

  return (
    <figure className="analytics-figure chart-panel" data-testid="trajectory-chart">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Trajectoires de maîtrise</span>
        <span className="analytics-figure__description">
          Historique des cinq premiers concepts sélectionnés. Les couleurs et les tirets
          distinguent chaque trajectoire.
        </span>
      </figcaption>
      <div className="chart-frame chart-frame--tall" aria-hidden="true">
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <XAxis dataKey="date" />
            <YAxis domain={[0, 1]} />
            <Tooltip />
            <Legend />
            {visible.map((cid, i) => {
              const style = chartSeriesStyle(i);
              return (
                <Line
                  key={cid}
                  type="monotone"
                  dataKey={cid}
                  name={conceptTitles[cid] ?? cid}
                  stroke={style.stroke}
                  strokeDasharray={style.dash}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption="Historique de maîtrise par concept"
        rows={chartData}
        rowKey={(row) => String(row.date)}
        columns={tableColumns}
      />
    </figure>
  );
}
