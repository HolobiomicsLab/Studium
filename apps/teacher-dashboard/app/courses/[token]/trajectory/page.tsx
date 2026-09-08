import { getConceptMasteryHistory, isSuppressed } from "@/lib/api";
import TrajectoryChart from "@/components/TrajectoryChart";
import CourseNav from "@/components/CourseNav";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function TrajectoryPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getConceptMasteryHistory(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="trajectory" />
      <h2 className="text-lg font-semibold mb-4">Trajectoire longitudinale de maîtrise</h2>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <TrajectoryChart data={data} />
      ) : null}
    </main>
  );
}
