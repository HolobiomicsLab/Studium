import { getReasoningDepth, isSuppressed } from "@/lib/api";
import ReasoningBreakdown from "@/components/ReasoningBreakdown";
import CourseNav from "@/components/CourseNav";
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
  let data;
  let error: string | null = null;
  try {
    data = await getReasoningDepth(token);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="reasoning" />
      <h2 className="text-lg font-semibold mb-4">Qualité du raisonnement</h2>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : isSuppressed(data) ? (
        <SuppressedNotice info={data} />
      ) : data ? (
        <ReasoningBreakdown data={data} />
      ) : null}
      {/* INT-STUDIUM-030: this page publishes a judgement metric, and the collector
          now sends `non_attribution` with it. The two pages that already carried this
          line were the two that had advertised a drill-down; these two never did, which
          is precisely why the line was missing here — nobody had had to argue about
          them. An unadvertised aggregate is not a less characterological one. */}
      <NonAttribution />
    </main>
  );
}
