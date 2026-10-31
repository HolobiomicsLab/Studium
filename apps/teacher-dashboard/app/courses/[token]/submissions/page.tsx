import { getLearnerItems } from "@/lib/api";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";
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
    <CourseShell token={token} active="submissions" eyebrow="Pilotage" title="Soumissions étudiantes">
      <DashboardNotice title="Modération avant diffusion">
        <p>
          Chaque scène est affichée intégralement, corrigé compris : approuvez en
          connaissance de cause (jamais en bloc). L&apos;approbation publie la scène
          (rule 003 : seule action de diffusion). L&apos;identité de l&apos;auteur·rice
          n&apos;est jamais affichée.
        </p>
      </DashboardNotice>
      {error ? (
        <ApiError message={error} />
      ) : items ? (
        <SubmissionsClient token={token} items={items} />
      ) : (
        <p className="empty-state">Aucune file de modération disponible.</p>
      )}
    </CourseShell>
  );
}
