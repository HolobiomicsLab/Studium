import { getAutonomy } from "@/lib/api";
import AutonomyBar from "@/components/AutonomyBar";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function AutonomyPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getAutonomy(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="autonomy" />
      <h2 className="text-lg font-semibold mb-4">Autonomie réflexive (anti-offloading)</h2>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : data ? (
        <AutonomyBar data={data} />
      ) : null}
    </main>
  );
}
