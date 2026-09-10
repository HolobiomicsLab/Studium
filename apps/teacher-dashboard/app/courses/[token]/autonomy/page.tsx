import { getAutonomy, isSuppressed } from "@/lib/api";
import AutonomyBar from "@/components/AutonomyBar";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
import NonAttribution from "@/components/NonAttribution";
import SuppressedNotice from "@/components/SuppressedNotice";

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
    <CourseShell token={token} active="autonomy" eyebrow="Apprentissages" title="Équilibre critique / indice">
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <AutonomyBar data={data} />
      ) : (
        <p className="empty-state">Aucune mesure critique / indice disponible.</p>
      )}
      {/* INT-STUDIUM-030: this page publishes a judgement metric, and the collector
          now sends `non_attribution` with it. The two pages that already carried this
          line were the two that had advertised a drill-down; these two never did, which
          is precisely why the line was missing here — nobody had had to argue about
          them. An unadvertised aggregate is not a less characterological one. */}
      <NonAttribution />
    </CourseShell>
  );
}
