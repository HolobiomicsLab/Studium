import { getTrustCalibration } from "@/lib/api";
import TrustCalibrationChart from "@/components/TrustCalibrationChart";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { learner?: string };
};

export default async function TrustCalibrationPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const learner = searchParams.learner;
  let data;
  let error: string | null = null;
  try {
    data = await getTrustCalibration(token, learner);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="trust-calibration" />
      <h2 className="text-lg font-semibold mb-4">Confiance dans le résultat de l’IA</h2>
      <p className="text-sm text-gray-600 mb-4">
        Mesure le jugement de l’apprenant·e face à une lecture IA d’un{" "}
        <strong>résultat réel</strong> qu’il·elle a exécuté : croit-il·elle l’IA
        quand elle a raison, et la corrige-t-il·elle quand elle se trompe ? C’est
        la <em>destination évaluée</em> du dispositif — distincte de la
        calibration de confiance déclarée.
      </p>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : data ? (
        <TrustCalibrationChart data={data} learner={learner} />
      ) : null}
      <p className="mt-6 text-xs text-gray-500">
        Astuce : ajouter <code>?learner=&lt;pseudonyme&gt;</code> à l&apos;URL pour
        filtrer sur un·e apprenant·e.
      </p>
    </main>
  );
}
