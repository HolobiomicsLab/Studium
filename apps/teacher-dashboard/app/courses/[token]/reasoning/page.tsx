import { getReasoningDepth } from "@/lib/api";
import ReasoningBreakdown from "@/components/ReasoningBreakdown";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { pseudonyme?: string };
};

export default async function ReasoningPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  let data;
  let error: string | null = null;
  try {
    data = await getReasoningDepth(token, { pseudonyme: searchParams.pseudonyme });
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
      ) : data ? (
        <ReasoningBreakdown data={data} />
      ) : null}
    </main>
  );
}
