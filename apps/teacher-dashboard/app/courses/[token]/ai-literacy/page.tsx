import { getAILiteracy } from "@/lib/api";
import AILiteracyCard from "@/components/AILiteracyCard";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { pseudonyme?: string };
};

export default async function AILiteracyPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const pseudonyme = searchParams.pseudonyme ?? "";
  let data = null;
  let error: string | null = null;
  if (pseudonyme) {
    try {
      data = await getAILiteracy(token, pseudonyme);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="ai-literacy" />
      <h2 className="text-lg font-semibold mb-4">Littératie IA (ADR 011)</h2>
      <p className="text-sm text-gray-700 mb-4 p-3 bg-yellow-50 rounded">
        ⚠ Cette vue affiche un indicateur <strong>formatif uniquement</strong>{" "}
        par étudiant. Aucun usage certificatif ; pas de comparaison
        inter-étudiants publique. Consulter ADR 011 pour les conditions
        d'usage.
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
        <button
          type="submit"
          className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-sm"
        >
          Consulter
        </button>
      </form>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : data ? (
        <AILiteracyCard pseudonyme={pseudonyme} data={data} />
      ) : pseudonyme ? null : (
        <p className="text-gray-500 italic">
          Sélectionne un pseudonyme étudiant pour consulter son index.
        </p>
      )}
    </main>
  );
}
