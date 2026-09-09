"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { ReasoningResponse } from "@/lib/api";
import CohortLine, { WithheldNotice } from "./CohortLine";

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
    // An empty `scenes` has two causes and the copy below used to assert the first one for
    // both: no signals arrived, or every scene that had signals was withheld under the floor
    // (INT-STUDIUM-030 R1). "Aucun signal reçu" is a claim, and in the second case a false
    // one — it tells a teacher their scenes are not instrumented when the truth is that their
    // class is small.
    return data.withheld_below_floor ? (
      <WithheldNotice className="text-sm text-amber-700" />
    ) : (
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
            {/* Per row, not once for the page: a scene's score is computed over the learners
                who produced signals in THAT scene, which is a narrower population than the
                course cohort the endpoint floored. This is the surface where the two diverge
                most: a class of thirty can leave one person's reasoning behind a scene's
                name, and the endpoint's floor would never have noticed. */}
            <CohortLine judgement={entry} className="text-xs text-gray-500 mb-2" />
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
      {data.withheld_below_floor ? <WithheldNotice className="text-sm text-amber-700" /> : null}
    </div>
  );
}
