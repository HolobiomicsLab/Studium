import { findLessonByToken } from "@/lib/library";
import { getReasoningDepth, isSuppressed } from "@/lib/api";
import ReasoningBreakdown from "@/components/ReasoningBreakdown";
import CourseShell from "@/components/CourseShell";
import { ApiError } from "@/components/DashboardNotice";
import NonAttribution from "@/components/NonAttribution";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

/**
 * This page forwarded `?pseudonyme=` to the collector — an unadvertised drill-down, which is
 * the more dangerous kind: nothing on the page said the number could be narrowed to one
 * student, so nothing would have prompted a reader to ask whether it should be
 * (INT-STUDIUM-030).
 */
type Props = { params: { token: string } };

export default async function ReasoningPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  const lesson = await findLessonByToken(token);
  let data;
  let error: string | null = null;
  try {
    data = await getReasoningDepth(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <CourseShell token={token} active="reasoning" eyebrow="Pratiques" title="Qualité du raisonnement">
      {error ? (
        <ApiError message={error} />
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <ReasoningBreakdown data={data} sceneTitles={Object.fromEntries((lesson?.outline ?? []).map((scene) => [scene.id, scene.title]))} />
      ) : (
        <p className="empty-state">Aucune mesure de raisonnement disponible.</p>
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
