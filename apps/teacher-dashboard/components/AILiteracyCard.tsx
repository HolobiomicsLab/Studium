"use client";

import type { AILiteracyResponse } from "@/lib/api";

function colorFor(value: number | null): string {
  if (value === null) return "bg-gray-200 text-gray-500";
  if (value >= 0.7) return "bg-emerald-500 text-white";
  if (value >= 0.5) return "bg-amber-300";
  if (value >= 0.3) return "bg-orange-400 text-white";
  return "bg-red-400 text-white";
}

type Props = { pseudonyme: string; data: AILiteracyResponse };

export default function AILiteracyCard({ pseudonyme, data }: Props) {
  const pct = data.value === null ? "—" : `${Math.round(data.value * 100)}%`;
  const icText = data.ic80
    ? `IC80 ±${(((data.ic80[1] - data.ic80[0]) / 2) * 100).toFixed(0)}%`
    : "IC indispo (<5 sessions)";
  return (
    <article
      className={`rounded p-4 shadow ${colorFor(data.value)}`}
      data-testid="ai-literacy-card"
    >
      <header className="flex justify-between items-baseline">
        <code className="text-xs opacity-80">{pseudonyme}</code>
        <div className="text-3xl font-bold">{pct}</div>
      </header>
      <p className="text-xs mt-1">
        n={data.n_sessions} sessions · {icText}
      </p>
      {data.degraded && (
        <p className="text-xs mt-1 italic">
          ⚠ composante manquante (degraded)
        </p>
      )}
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer">Composantes</summary>
        <ul className="mt-1 space-y-0.5">
          <li>
            ai_audit_accuracy : {data.components.ai_audit_accuracy ?? "—"}
          </li>
          <li>
            hint_independence_trend :{" "}
            {data.components.hint_independence_trend ?? "—"}
          </li>
          <li>
            critique_completion_rate :{" "}
            {data.components.critique_completion_rate ?? "—"}
          </li>
        </ul>
      </details>
      <footer className="mt-3 text-xs italic border-t pt-2">
        Indicateur formatif — non validé pour usage certificatif (ADR 011).
      </footer>
    </article>
  );
}
