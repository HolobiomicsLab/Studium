import { getCalibration, isSuppressed } from "@/lib/api";
import CalibrationChart from "@/components/CalibrationChart";
import CourseNav from "@/components/CourseNav";
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
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="calibration" />
      <h2 className="text-lg font-semibold mb-4">Calibration des réponses</h2>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <CalibrationChart data={data} />
      ) : null}
      <NonAttribution />
    </main>
  );
}
