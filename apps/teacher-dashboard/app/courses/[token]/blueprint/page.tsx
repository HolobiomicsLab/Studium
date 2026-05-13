import { postBlueprintScore, type AssessmentBlueprintInput } from "@/lib/api";
import BlueprintRadar from "@/components/BlueprintRadar";
import CourseNav from "@/components/CourseNav";

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
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="blueprint" />
      <h2 className="text-lg font-semibold mb-4">Blueprint d'évaluation (ADR 013)</h2>
      <p className="text-sm text-gray-700 mb-4 p-3 bg-yellow-50 rounded">
        ⚠ Indicateur composite <strong>formatif uniquement</strong>. Pondérations
        configurées par l'enseignant. Pas d'usage certificatif sans validation
        pédagogique (ADR 013). Blueprint par défaut v1 — édition via UI auteur
        reportée à M6.5+.
      </p>
      <form className="mb-4">
        <label className="text-sm">
          Pseudonyme étudiant :
          <input
            type="text"
            name="pseudonyme"
            defaultValue={pseudonyme}
            className="ml-2 border rounded p-1 text-sm font-mono"
            placeholder="HMAC hex"
          />
        </label>
        <button type="submit" className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-sm">
          Consulter
        </button>
      </form>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : data ? (
        <BlueprintRadar data={data} />
      ) : pseudonyme ? null : (
        <p className="text-gray-500 italic">
          Sélectionne un pseudonyme étudiant pour consulter son blueprint.
        </p>
      )}
    </main>
  );
}
