"use client";

import type { TrustCalibrationResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";
import CohortLine, { WithheldNotice } from "./CohortLine";

// No `learner` prop: this chart renders a class aggregate and nothing else, because the
// collector no longer serves a narrowed one (INT-STUDIUM-030). A per-learner TITLE with no
// per-learner DATA behind it would be the most misleading state of all.
type Props = { data: TrustCalibrationResponse };

// Maps the engine's signed trust gap + band to a teacher-facing verdict.
// POSITIVE gap = over-trust (missed planted flaws ⇒ too credulous toward the AI);
// NEGATIVE = over-distrust (flagged sound claims ⇒ too skeptical). Formative only.
// Takes the whole response, not just the band, because the null band has TWO causes and they
// call for opposite actions from the teacher: no scene carried a planted flaw (nothing to
// measure — check the bundle), or the audit was measured and withheld under the floor (nothing
// to check — the class is small). The collector already distinguishes them in `reason`;
// rendering one verdict for both would send a teacher looking for a scene that is there.
function qualifyBand(
  data: TrustCalibrationResponse,
): { label: string; tone: string; hint: string } {
  switch (data.band) {
    case "bien":
      return {
        label: "Jugement bien calibré",
        tone: "strong",
        hint: "L’apprenant·e croit l’IA quand elle a raison et la corrige quand elle se trompe.",
      };
    case "sur":
      return {
        label: "Surconfiance en l’IA",
        tone: "low",
        hint: "Des défauts plantés dans la lecture IA sont passés inaperçus — tendance à trop faire confiance au résultat.",
      };
    case "sous":
      return {
        label: "Méfiance excessive envers l’IA",
        tone: "watch",
        hint: "Des affirmations correctes ont été signalées à tort comme fausses — tendance à trop se méfier du résultat.",
      };
    default:
      return data.withheld_below_floor
        ? {
            label: "Mesure retenue — plancher d’anonymat",
            tone: "muted",
            hint:
              "L’audit a bien eu lieu : ce sont les apprenant·e·s qui l’ont alimenté qui " +
              "sont moins nombreux·ses que le plancher dans au moins une leçon. Rien à " +
              "corriger dans le parcours — le chiffre reviendra avec une cohorte plus large.",
          }
        : {
            label: "Données insuffisantes",
            tone: "muted",
            hint: "Aucun audit « repère le défaut » ancré sur un résultat réel n’a encore été joué.",
          };
  }
}

function pct(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)} %`;
}

export default function TrustCalibrationChart({ data }: Props) {
  const q = qualifyBand(data);
  const gap = data.trust_calibration;
  // Round for display, then collapse a -0 (tiny negative ⇒ "-0.00") to 0 so the
  // sign never implies an over-distrust direction the value doesn't actually have.
  const rounded = gap === null ? null : Math.round(gap * 100) / 100;
  const shownGap = rounded === null ? null : Object.is(rounded, -0) ? 0 : rounded;
  const shownGapText = shownGap === null
    ? "—"
    : (shownGap > 0 ? "+" : "") + shownGap.toFixed(2);
  return (
    <figure className="analytics-figure metric-panel" data-testid="trust-calibration-chart">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">Confiance en l’IA — agrégée</span>
        <span className="analytics-figure__description">
          Écart signé entre les défauts manqués et les affirmations correctes signalées à tort.
        </span>
      </figcaption>
      <div className="metric-panel__reading">
        <span className="metric-panel__value">{shownGapText}</span>
        <span className="metric-panel__unit">
          écart de confiance signé ∈ [−1, +1] · + surconfiance / − méfiance
        </span>
      </div>
      <p className={`metric-panel__verdict metric-panel__verdict--${q.tone}`}>
        {q.label}
      </p>
      <p className="metric-panel__support">{q.hint}</p>
      {data.band !== null ? (
        <dl className="metric-details">
          <div>
            <dt>Surconfiance (défauts manqués)</dt>
            <dd>{pct(data.over_trust)}</dd>
          </div>
          <div>
            <dt>Méfiance (faux positifs)</dt>
            <dd>{pct(data.over_distrust)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="metric-panel__definition">
        Calculé sur {data.n_audits} scène{data.n_audits > 1 ? "s" : ""} « repère le
        défaut » ancrée{data.n_audits > 1 ? "s" : ""} sur un résultat réel (les audits
        d&apos;une même scène sont regroupés). Distinct de la calibration de confiance
        (déclaré-vs-compétence).
      </p>
      {/* INT-STUDIUM-030 R1. The line above counts SCENES, and a scene is not a population:
          two scenes can be two learners. The band below is the union of the learners behind
          the PUBLISHED scenes — scenes that were withheld, and scenes nobody could be scored
          on, contribute no one to it and no number to the gap. */}
      <CohortLine judgement={data.judgement} />
      {data.withheld_below_floor ? <WithheldNotice /> : null}
      {/* INT-STUDIUM-003. The previous footnote said the offline detector never emits
          false positives, so only over-trust is ever fed. The verdict deck ended that:
          a scene declaring `sound_claims` is graded with real false_positives and
          sound_total (lesson-session/src/grading/graders.ts:151), and only the free-text
          keyword path is fixed at fp=0/sound=0 (graders.ts:158,
          grading/ai-audit-matcher.ts:39) — which the collector reports as UNMEASURED
          rather than zero (metrics._over_distrust_rate). The panel above already renders
          a measured over-distrust and a "sous" verdict, so the old sentence contradicted
          the numbers beside it. */}
      <p className="measurement-limit">
        Limite de mesure : la direction « méfiance » n’est alimentée que par les scènes
        qui déclarent des affirmations correctes (sound_claims) et sont corrigées par le
        barème de verdicts — là, les faux positifs sont comptés réellement. Sur le chemin
        mots-clés hors-ligne, aucune affirmation correcte n’est proposée : la méfiance y
        est <b>non mesurée</b> (affichée « — »), et non nulle. Une direction non mesurée
        compte 0 dans l’écart signé, qui ne peut donc pas devenir négatif faute de mesure.
      </p>
      <ChartDataTable
        caption="Données de confiance en l’IA"
        rows={[
          { metric: "Écart de confiance signé", value: shownGapText },
          { metric: "Surconfiance", value: pct(data.over_trust) },
          { metric: "Méfiance", value: pct(data.over_distrust) },
          { metric: "Scènes auditées publiées", value: String(data.n_audits) },
          { metric: "Interprétation", value: q.label },
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
