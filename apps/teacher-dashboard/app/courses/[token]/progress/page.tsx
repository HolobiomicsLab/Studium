import { getProgress, isSuppressed } from "@/lib/api";
import ProgressHeatmap from "@/components/ProgressHeatmap";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
import SuppressedNotice from "@/components/SuppressedNotice";

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
    <CourseShell
      token={token}
      active="progress"
      eyebrow="Vue d’ensemble"
      title="Progression par scène"
      description="Une lecture synthétique des scènes terminées, pour localiser les avancées et les points d’attention du cours."
    >
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <ProgressHeatmap data={data} />
      ) : (
        <p className="empty-state">Aucune lecture de progression disponible.</p>
      )}
    </CourseShell>
  );
}
