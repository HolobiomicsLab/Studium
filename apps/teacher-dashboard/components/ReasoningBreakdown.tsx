"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import type { ReasoningResponse } from "@/lib/api";
import {
  CHART_FALLBACK_COLOR,
  REASONING_SIGNAL_COLORS,
} from "@/lib/chart-palette";
import CohortLine, { WithheldNotice } from "./CohortLine";
import ChartDataTable from "./ChartDataTable";

type Props = { data: ReasoningResponse; sceneTitles?: Record<string, string> };

export default function ReasoningBreakdown({ data, sceneTitles = {} }: Props) {
  const entries = Object.entries(data.scenes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    // An empty `scenes` has two causes and the copy below used to assert the first one for
    // both: no signals arrived, or every scene that had signals was withheld under the floor
    // (INT-STUDIUM-030 R1). "Aucun signal reçu" is a claim, and in the second case a false
    // one — it tells a teacher their scenes are not instrumented when the truth is that their
    // class is small.
    return data.withheld_below_floor ? (
      <WithheldNotice className="analytics-note analytics-note--warning" />
    ) : (
      <p className="empty-state">
        Aucun signal de raisonnement reçu pour ce cours.
      </p>
    );
  }
  return (
    <div className="reasoning-grid" data-testid="reasoning-breakdown">
      {entries.map(([sceneId, entry]) => {
        const breakdownArr = Object.entries(entry.breakdown).map(
          ([signal, proportion]) => ({ signal, proportion }),
        );
        return (
          <figure key={sceneId} className="analytics-figure chart-card">
            <figcaption className="chart-card__header">
              <span className="analytics-figure__title">
                {sceneTitles[sceneId] ?? sceneId}
                {sceneTitles[sceneId] ? <code className="metric-id">{sceneId}</code> : null}
              </span>
              <span className="chart-card__score">
                {entry.score === null ? "—" : `${Math.round(entry.score * 100)}%`}
              </span>
            </figcaption>
            <p className="chart-card__meta">
              {entry.n_signals} signaux observés
            </p>
            {/* Per row, not once for the page: a scene's score is computed over the learners
                who produced signals in THAT scene, which is a narrower population than the
                course cohort the endpoint floored. This is the surface where the two diverge
                most: a class of thirty can leave one person's reasoning behind a scene's
                name, and the endpoint's floor would never have noticed. */}
            <CohortLine judgement={entry} className="chart-card__cohort" />
            <div className="chart-frame chart-frame--compact" aria-hidden="true">
              <ResponsiveContainer>
                <BarChart layout="vertical" data={breakdownArr}>
                  <XAxis type="number" domain={[0, 1]} hide />
                  <YAxis dataKey="signal" type="category" width={120} />
                  <Tooltip />
                  <Bar dataKey="proportion" isAnimationActive={false}>
                    {breakdownArr.map((b) => (
                      <Cell
                        key={b.signal}
                        fill={REASONING_SIGNAL_COLORS[b.signal] ?? CHART_FALLBACK_COLOR}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartDataTable
              caption={`Répartition des signaux — ${sceneTitles[sceneId] ?? sceneId}`}
              rows={breakdownArr}
              rowKey={(row) => row.signal}
              columns={[
                {
                  key: "signal",
                  label: "Signal",
                  rowHeader: true,
                  render: (row) => row.signal,
                },
                {
                  key: "proportion",
                  label: "Proportion",
                  render: (row) => `${Math.round(row.proportion * 100)} %`,
                },
              ]}
            />
          </figure>
        );
      })}
      {data.withheld_below_floor ? (
        <WithheldNotice className="analytics-note analytics-note--warning" />
      ) : null}
    </div>
  );
}
