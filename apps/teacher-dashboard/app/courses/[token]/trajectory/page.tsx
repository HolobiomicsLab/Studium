import { getConceptMasteryHistory, isSuppressed, isUnavailable } from "@/lib/api";
import TrajectoryChart from "@/components/TrajectoryChart";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
import SuppressedNotice from "@/components/SuppressedNotice";
import UnavailableNotice from "@/components/UnavailableNotice";

export const dynamic = "force-dynamic";

/**
 * The collector withdrew this route (INT-STUDIUM-030): its rows are keyed by pseudonym, so no
 * parameter list makes it class-level, and the snapshots behind it were never written — the
 * strict telemetry schema does not carry `concept_states`.
 *
 * The withdrawal is rendered as its own state, NOT as `SuppressedNotice`. Suppression means
 * "this class is too small today"; showing it here would tell a teacher something false about
 * their class instead of something true about the instrument.
 */
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
    <CourseShell token={token} active="trajectory" eyebrow="Apprentissages" title="Trajectoire longitudinale de maîtrise">
      {error ? (
        <ApiError message={error} />
      ) : isUnavailable(data) ? (
        <UnavailableNotice info={data} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <TrajectoryChart data={data} />
      ) : (
        <p className="empty-state">Aucune trajectoire disponible.</p>
      )}
    </CourseShell>
  );
}
