import { getProgress } from "@/lib/api";
import ProgressHeatmap from "@/components/ProgressHeatmap";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function ProgressPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getProgress(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="progress" />
      <h2 className="text-lg font-semibold mb-4">Progression par scène</h2>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : data ? (
        <ProgressHeatmap data={data} />
      ) : null}
    </main>
  );
}
