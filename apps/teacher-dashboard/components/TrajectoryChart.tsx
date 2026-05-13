"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { ConceptMasteryHistoryResponse } from "@/lib/api";

type Props = { data: ConceptMasteryHistoryResponse; selectedConcepts?: string[] };

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#9333ea"];

export default function TrajectoryChart({ data, selectedConcepts }: Props) {
  const concepts = Object.keys(data.concepts);
  const visible = selectedConcepts && selectedConcepts.length > 0
    ? concepts.filter((c) => selectedConcepts.includes(c)).slice(0, 5)
    : concepts.slice(0, 5);

  if (visible.length === 0) {
    return (
      <p className="text-gray-500 italic">
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

  return (
    <div className="w-full h-96" data-testid="trajectory-chart">
      <ResponsiveContainer>
        <LineChart data={chartData}>
          <XAxis dataKey="date" />
          <YAxis domain={[0, 1]} />
          <Tooltip />
          <Legend />
          {visible.map((cid, i) => (
            <Line
              key={cid}
              type="monotone"
              dataKey={cid}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
