import { getLearnerItems } from "@/lib/api";
import CourseNav from "@/components/CourseNav";
import SubmissionsClient from "./SubmissionsClient";

export const dynamic = "force-dynamic";

type Props = { params: { token: string } };

export default async function SubmissionsPage({ params }: Props) {
  const token = decodeURIComponent(params.token);
  let items;
  let error: string | null = null;
  try {
    const res = await getLearnerItems(token, "submitted");
    items = res.items;
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="submissions" />
      <h2 className="text-lg font-semibold mb-4">
        Soumissions étudiantes (modération)
      </h2>
      <p className="text-sm text-gray-700 mb-4 p-3 bg-blue-50 rounded">
        Chaque scène est affichée intégralement, corrigé compris : approuvez en
        connaissance de cause (jamais en bloc). L&apos;approbation publie la scène
        (rule 003 : seule action de diffusion). L&apos;identité de l&apos;auteur·rice
        n&apos;est jamais affichée.
      </p>
      {error ? (
        <p className="text-red-600">Erreur API : {error}</p>
      ) : items ? (
        <SubmissionsClient token={token} items={items} />
      ) : null}
    </main>
  );
}
