import { getCooperationStats, isSuppressed } from "@/lib/api";
import CooperationStats from "@/components/CooperationStats";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";
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
    <CourseShell token={token} active="cooperation" eyebrow="Pratiques" title="Coopération">
      <DashboardNotice title="En attente de M4" tone="caution">
        <p>
          Surface coopérative LAN pas encore livrée. Cette vue rend les agrégats
          si des sessions sont POSTées via collector (fixtures de test ou pilote M4 ultérieur).
        </p>
      </DashboardNotice>
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <CooperationStats data={data} />
      ) : (
        <p className="empty-state">Aucun agrégat de coopération disponible.</p>
      )}
    </CourseShell>
  );
}
