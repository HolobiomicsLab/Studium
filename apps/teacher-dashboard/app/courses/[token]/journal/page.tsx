import { getJournalStats, isSuppressed } from "@/lib/api";
import JournalStatsCard from "@/components/JournalStatsCard";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";
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
    <CourseShell token={token} active="journal" eyebrow="Pratiques" title="Journal d'apprentissage">
      <DashboardNotice title="Confidentialité — ADR 006" tone="caution">
        <p>
          Stats anonymes uniquement. Le texte des journaux reste local sur les
          machines étudiantes (rule ADR 006). Seuls la longueur et le taux de
          révision sont transmis.
        </p>
      </DashboardNotice>
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <JournalStatsCard data={data} />
      ) : (
        <p className="empty-state">Aucune statistique de journal disponible.</p>
      )}
    </CourseShell>
  );
}
