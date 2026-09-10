import { getCalibration, isSuppressed } from "@/lib/api";
import CalibrationChart from "@/components/CalibrationChart";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
import NonAttribution from "@/components/NonAttribution";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

/**
 * This page used to advertise its own drill-down — « Astuce : ajouter `?learner=<pseudonyme>`
 * à l'URL » — and read `searchParams.learner` into the request. Both are gone
 * (INT-STUDIUM-030). A floor with a drill-down behind it is not a floor: twenty aggregates
 * over caller-chosen subsets reconstruct an individual without any one of them falling under
 * five. The tip is replaced by the line that says what the number IS, since a reader who has
 * just been told they cannot ask about one student is owed the reason.
 */
type Props = { params: { token: string } };

export default async function CalibrationPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getCalibration(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <CourseShell token={token} active="calibration" eyebrow="Apprentissages" title="Calibration des réponses">
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <CalibrationChart data={data} />
      ) : (
        <p className="empty-state">Aucune mesure de calibration disponible.</p>
      )}
      <NonAttribution />
    </CourseShell>
  );
}
