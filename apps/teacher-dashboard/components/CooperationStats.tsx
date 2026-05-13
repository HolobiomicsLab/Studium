"use client";

import type { CooperationStatsResponse } from "@/lib/api";

type Props = { data: CooperationStatsResponse };

const fmtPct = (n: number | null) =>
  n === null ? "—" : `${Math.round(n * 100)}%`;

export default function CooperationStats({ data }: Props) {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-4"
      data-testid="cooperation-stats"
    >
      <Kpi label="Sessions" value={data.n_sessions} />
      <Kpi label="Convergence" value={fmtPct(data.convergence_quality)} />
      <Kpi label="Couverture rôles" value={fmtPct(data.role_coverage_mean)} />
      <Kpi label="Votes/session moy." value={data.votes_per_session_mean} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white shadow rounded p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}
