import { getCooperationStats, isSuppressed } from "@/lib/api";
import CooperationStats from "@/components/CooperationStats";
import CourseNav from "@/components/CourseNav";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function CooperationPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getCooperationStats(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="cooperation" />
      <h2 className="text-lg font-semibold mb-4">Coopération</h2>
      <p className="text-sm text-gray-700 mb-4 p-3 bg-yellow-50 rounded">
        ⚠ En attente de M4 — surface coopérative LAN pas encore livrée.
        Cette vue rend les agrégats si des sessions sont POSTées via collector
        (fixtures de test ou pilote M4 ultérieur).
      </p>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <CooperationStats data={data} />
      ) : null}
    </main>
  );
}
