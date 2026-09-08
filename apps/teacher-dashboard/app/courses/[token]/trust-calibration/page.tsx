import { getTrustCalibration, isSuppressed } from "@/lib/api";
import TrustCalibrationChart from "@/components/TrustCalibrationChart";
import CourseNav from "@/components/CourseNav";
import NonAttribution from "@/components/NonAttribution";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

/**
 * The `?learner=<pseudonyme>` drill-down this page advertised is gone (INT-STUDIUM-030), and
 * this is the page it mattered most on: over-trust is the most characterological reading the
 * instrument produces, so it was the last one that should have been available per student to
 * a reader who already holds the roster.
 */
type Props = { params: { token: string } };

export default async function TrustCalibrationPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getTrustCalibration(token);
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
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <TrustCalibrationChart data={data} />
      ) : null}
      <NonAttribution />
    </main>
  );
}
