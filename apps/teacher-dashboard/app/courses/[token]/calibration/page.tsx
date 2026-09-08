import { getCalibration, isSuppressed } from "@/lib/api";
import CalibrationChart from "@/components/CalibrationChart";
import CourseNav from "@/components/CourseNav";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { learner?: string };
};

export default async function CalibrationPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const learner = searchParams.learner;
  let data;
  let error: string | null = null;
  try {
    data = await getCalibration(token, learner);
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
        <CalibrationChart data={data} learner={learner} />
      ) : null}
      <p className="mt-6 text-xs text-gray-500">
        Astuce : ajouter <code>?learner=&lt;pseudonyme&gt;</code> à l&apos;URL pour
        filtrer sur un·e apprenant·e.
      </p>
    </main>
  );
}
