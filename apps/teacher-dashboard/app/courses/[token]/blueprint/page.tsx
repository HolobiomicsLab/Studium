import { postBlueprintScore, type AssessmentBlueprintInput } from "@/lib/api";
import BlueprintRadar from "@/components/BlueprintRadar";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { pseudonyme?: string };
};

// Default blueprint v1 — hardcoded sample. Until M1 UI auteur lands, the
// teacher must supply the blueprint in the bundle and edit this default
// in code for the dashboard pre-fill.
const DEFAULT_BLUEPRINT: AssessmentBlueprintInput = {
  dimensions: [
    {
      id: "critical_thinking",
      label: "Pensée critique",
      weight: 0.5,
      metrics: [
        { endpoint: "ai_literacy", field: "value", weight_in_dimension: 1.0 },
      ],
    },
    {
      id: "metacognition",
      label: "Métacognition",
      weight: 0.5,
      metrics: [
        { endpoint: "calibration", field: "brier_score", weight_in_dimension: 1.0 },
      ],
    },
  ],
};

export default async function BlueprintPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const pseudonyme = searchParams.pseudonyme ?? "";
  let data = null;
  let error: string | null = null;
  if (pseudonyme) {
    try {
      data = await postBlueprintScore(token, pseudonyme, DEFAULT_BLUEPRINT);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <CourseShell token={token} active="blueprint" eyebrow="Pilotage" title="Blueprint d'évaluation">
      <DashboardNotice title="Cadre d’usage — ADR 013" tone="caution">
        <p>
          Indicateur composite <strong>formatif uniquement</strong>. Pondérations
          configurées par l'enseignant. Pas d'usage certificatif sans validation
          pédagogique (ADR 013). Blueprint par défaut v1 — édition via UI auteur
          reportée à M6.5+.
        </p>
      </DashboardNotice>
      <form className="inline-form">
        <label className="field">
          <span className="field__label">Pseudonyme étudiant</span>
          <input
            type="text"
            name="pseudonyme"
            defaultValue={pseudonyme}
            className="field__input"
            placeholder="HMAC hex"
          />
        </label>
        <button type="submit" className="primary-button">
          Consulter
        </button>
      </form>
      {error ? (
        <ApiError message={error} />
      ) : data ? (
        <BlueprintRadar data={data} />
      ) : pseudonyme ? null : (
        <p className="empty-state">
          Sélectionne un pseudonyme étudiant pour consulter son blueprint.
        </p>
      )}
    </CourseShell>
  );
}
