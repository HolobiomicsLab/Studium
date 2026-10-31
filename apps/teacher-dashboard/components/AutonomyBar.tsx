"use client";

import type { AutonomyResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";
import CohortLine from "./CohortLine";

type Props = { data: AutonomyResponse };

export default function AutonomyBar({ data }: Props) {
  const ratioPct = Math.round(data.autonomy_ratio * 100);
  const completionPct = Math.round(data.critique_completion_rate * 100);
  const total = data.n_critique + data.n_hints;
  const ratioTone = ratioPct >= 60 ? "strong" : ratioPct >= 40 ? "watch" : "low";
  return (
    <figure className="analytics-figure metric-panel" data-testid="autonomy-bar">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Engagement critique agrégé</span>
        <span className="analytics-figure__description">
          Deux rapports distincts sur les interactions adaptatives du cours.
        </span>
      </figcaption>
      <div className="measure-list">
        <div className="measure-row">
          <div className="measure-row__header">
          {/* INT-STUDIUM-023: this is the collector's course-level ratio of events
              (metrics.AUTONOMY_INDICATOR_NAME). The runtime computes a different ratio
              under the same wire key `autonomy_ratio` — scenes completed over scenes plus
              scaffolding, per session — which the class report publishes as "mean
              scaffolding independence". Neither key is renamed; the names differ so the
              two numbers are not read as one. */}
          <span>Équilibre critique / indice</span>
            <strong>{ratioPct}%</strong>
          </div>
          <div className="measure-bar" aria-hidden="true">
            <span
              className={`measure-bar__fill measure-bar__fill--${ratioTone}`}
              style={{ width: `${ratioPct}%` }}
            />
          </div>
          <p className="measure-row__note">
            {data.n_critique} critique{data.n_critique > 1 ? "s" : ""} soumise
            {data.n_critique > 1 ? "s" : ""} sur {total} interactions adaptatives
            (critique + hint).
          </p>
        </div>
        <div className="measure-row">
          <div className="measure-row__header">
            <span>Taux de complétion des critiques</span>
            <strong>{completionPct}%</strong>
          </div>
          <div className="measure-bar" aria-hidden="true">
            <span
              className="measure-bar__fill measure-bar__fill--ink"
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>
      </div>
      <p className="metric-panel__definition">
        Anti-offloading : plus l&apos;équilibre critique / indice est élevé, plus les
        apprenant·e·s engagent une critique réflexive plutôt que de demander un indice.
      </p>
      {/* INT-STUDIUM-030 R1: both terms of the ratio (critiques and hints) contribute to it,
          so the population named here is the union of the learners behind both — not the
          course roster, and not the critique side alone. */}
      <CohortLine judgement={data.judgement} />
      <p className="measurement-limit">
        Mesure de classe, sur les événements de ce cours. À ne pas confondre avec
        l&apos;<i>indépendance vis-à-vis de l&apos;étayage</i> du rapport de classe, calculée
        par session sur l&apos;appareil (scènes terminées / scènes + étayage) : deux mesures
        différentes transmises sous la même clé <code>autonomy_ratio</code>.
      </p>
      <ChartDataTable
        caption="Données d’engagement critique"
        rows={[
          { metric: "Équilibre critique / indice", value: `${ratioPct} %` },
          { metric: "Taux de complétion des critiques", value: `${completionPct} %` },
          { metric: "Critiques soumises", value: String(data.n_critique) },
          { metric: "Indices demandés", value: String(data.n_hints) },
          { metric: "Interactions adaptatives", value: String(total) },
          { metric: "Bande de cohorte", value: data.judgement.cohort_band ?? "—" },
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
