"use client";

import type { TrustCalibrationResponse } from "@/lib/api";

type Props = { data: TrustCalibrationResponse; learner?: string };

// Maps the engine's signed trust gap + band to a teacher-facing verdict.
// POSITIVE gap = over-trust (missed planted flaws ⇒ too credulous toward the AI);
// NEGATIVE = over-distrust (flagged sound claims ⇒ too skeptical). Formative only.
function qualifyBand(
  band: TrustCalibrationResponse["band"],
): { label: string; color: string; hint: string } {
  switch (band) {
    case "bien":
      return {
        label: "Jugement bien calibré",
        color: "text-emerald-700",
        hint: "L’apprenant·e croit l’IA quand elle a raison et la corrige quand elle se trompe.",
      };
    case "sur":
      return {
        label: "Surconfiance en l’IA",
        color: "text-red-600",
        hint: "Des défauts plantés dans la lecture IA sont passés inaperçus — tendance à trop faire confiance au résultat.",
      };
    case "sous":
      return {
        label: "Méfiance excessive envers l’IA",
        color: "text-amber-600",
        hint: "Des affirmations correctes ont été signalées à tort comme fausses — tendance à trop se méfier du résultat.",
      };
    default:
      return {
        label: "Données insuffisantes",
        color: "text-gray-500",
        hint: "Aucun audit « repère le défaut » ancré sur un résultat réel n’a encore été joué.",
      };
  }
}

function pct(x: number | null): string {
  return x === null ? "—" : `${Math.round(x * 100)} %`;
}

export default function TrustCalibrationChart({ data, learner }: Props) {
  const q = qualifyBand(data.band);
  const gap = data.trust_calibration;
  // Round for display, then collapse a -0 (tiny negative ⇒ "-0.00") to 0 so the
  // sign never implies an over-distrust direction the value doesn't actually have.
  const rounded = gap === null ? null : Math.round(gap * 100) / 100;
  const shownGap = rounded === null ? null : Object.is(rounded, -0) ? 0 : rounded;
  return (
    <div className="space-y-3" data-testid="trust-calibration-chart">
      <h3 className="font-semibold">
        {learner ? `Confiance en l’IA — ${learner}` : "Confiance en l’IA — agrégée"}
      </h3>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums">
          {shownGap !== null ? (shownGap > 0 ? "+" : "") + shownGap.toFixed(2) : "—"}
        </span>
        <span className="text-sm text-gray-500">
          écart de confiance signé ∈ [−1, +1] · + surconfiance / − méfiance
        </span>
      </div>
      <p className={`font-medium ${q.color}`}>{q.label}</p>
      <p className="text-sm text-gray-600">{q.hint}</p>
      {data.band !== null ? (
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-gray-500">Surconfiance (défauts manqués)</dt>
            <dd className="font-semibold tabular-nums">{pct(data.over_trust)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Méfiance (faux positifs)</dt>
            <dd className="font-semibold tabular-nums">{pct(data.over_distrust)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="text-xs text-gray-500">
        Calculé sur {data.n_audits} scène{data.n_audits > 1 ? "s" : ""} « repère le
        défaut » ancrée{data.n_audits > 1 ? "s" : ""} sur un résultat réel (les audits
        d&apos;une même scène sont regroupés). Distinct de la calibration de confiance
        (déclaré-vs-compétence).
      </p>
      <p className="text-xs text-gray-400">
        Limite d’honnêteté : le détecteur de défauts hors-ligne n’émet pas de faux
        positifs (false_positives = 0), donc la direction « méfiance » n’est
        structurellement pas alimentée en production aujourd’hui — seule la
        surconfiance est mesurée tant qu’un correcteur plus riche ne fournit pas
        de signal d’affirmations correctes.
      </p>
    </div>
  );
}
