"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { ReasoningResponse } from "@/lib/api";

const SIGNAL_COLORS: Record<string, string> = {
  justification: "#2563eb",
  hypothesis: "#16a34a",
  counterexample: "#dc2626",
  synthesis: "#9333ea",
  question: "#ca8a04",
};

type Props = { data: ReasoningResponse };

export default function ReasoningBreakdown({ data }: Props) {
  const entries = Object.entries(data.scenes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return (
      <p className="text-gray-500 italic">
        Aucun signal de raisonnement reçu pour ce cours.
      </p>
    );
  }
  return (
    <div className="space-y-6" data-testid="reasoning-breakdown">
      {entries.map(([sceneId, entry]) => {
        const breakdownArr = Object.entries(entry.breakdown).map(
          ([signal, proportion]) => ({ signal, proportion }),
        );
        return (
          <section key={sceneId} className="bg-white rounded shadow p-4">
            <header className="flex justify-between items-baseline mb-2">
              <code className="text-sm">{sceneId}</code>
              <span className="text-lg font-bold">
                {entry.score === null ? "—" : `${Math.round(entry.score * 100)}%`}
              </span>
            </header>
            <p className="text-xs text-gray-500 mb-2">
              {entry.n_signals} signaux observés
            </p>
            <div className="w-full h-32">
              <ResponsiveContainer>
                <BarChart layout="vertical" data={breakdownArr}>
                  <XAxis type="number" domain={[0, 1]} hide />
                  <YAxis dataKey="signal" type="category" width={120} />
                  <Tooltip />
                  <Bar dataKey="proportion">
                    {breakdownArr.map((b) => (
                      <Cell key={b.signal} fill={SIGNAL_COLORS[b.signal] ?? "#888"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        );
      })}
    </div>
  );
}
