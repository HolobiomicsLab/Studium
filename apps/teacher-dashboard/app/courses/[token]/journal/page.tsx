import { getJournalStats, isSuppressed } from "@/lib/api";
import JournalStatsCard from "@/components/JournalStatsCard";
import CourseNav from "@/components/CourseNav";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function JournalPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getJournalStats(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="journal" />
      <h2 className="text-lg font-semibold mb-4">Journal d'apprentissage</h2>
      <p className="text-sm text-gray-700 mb-4 p-3 bg-yellow-50 rounded">
        ⚠ Stats anonymes uniquement. Le texte des journaux reste local sur les
        machines étudiantes (rule ADR 006). Seuls la longueur et le taux de
        révision sont transmis.
      </p>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <JournalStatsCard data={data} />
      ) : null}
    </main>
  );
}
