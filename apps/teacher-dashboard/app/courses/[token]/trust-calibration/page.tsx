import { getTrustCalibration, isSuppressed } from "@/lib/api";
import TrustCalibrationChart from "@/components/TrustCalibrationChart";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
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
    <CourseShell
      token={token}
      active="trust-calibration"
      eyebrow="Apprentissages"
      title="Confiance dans le résultat de l’IA"
      description={
        <p>
        Mesure le jugement de l’apprenant·e face à une lecture IA d’un{" "}
        <strong>résultat réel</strong> qu’il·elle a exécuté : croit-il·elle l’IA
        quand elle a raison, et la corrige-t-il·elle quand elle se trompe ? C’est
        la <em>destination évaluée</em> du dispositif — distincte de la
        calibration de confiance déclarée.
        </p>
      }
    >
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <TrustCalibrationChart data={data} />
      ) : (
        <p className="empty-state">Aucune mesure de confiance disponible.</p>
      )}
      <NonAttribution />
    </CourseShell>
  );
}
