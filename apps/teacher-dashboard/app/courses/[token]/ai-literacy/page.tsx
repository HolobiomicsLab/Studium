import { getAILiteracy } from "@/lib/api";
import AILiteracyCard from "@/components/AILiteracyCard";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { pseudonyme?: string };
};

export default async function AILiteracyPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const pseudonyme = searchParams.pseudonyme ?? "";
  let data = null;
  let error: string | null = null;
  if (pseudonyme) {
    try {
      data = await getAILiteracy(token, pseudonyme);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <CourseShell token={token} active="ai-literacy" eyebrow="Pratiques" title="Littératie IA">
      <DashboardNotice title="Cadre d’usage — ADR 011" tone="caution">
        <p>
          Cette vue affiche un indicateur <strong>formatif uniquement</strong>{" "}
          par étudiant. Aucun usage certificatif ; pas de comparaison
          inter-étudiants publique. Consulter ADR 011 pour les conditions
          d'usage.
        </p>
      </DashboardNotice>
      <form className="inline-form">
        <label className="field">
          <span className="field__label">Pseudonyme étudiant</span>
          <input
            type="text"
            name="pseudonyme"
            defaultValue={pseudonyme}
            className="field__input"
            placeholder="HMAC hex"
          />
        </label>
        <button type="submit" className="primary-button">
          Consulter
        </button>
      </form>
      {error ? (
        <ApiError message={error} />
      ) : data ? (
        <AILiteracyCard pseudonyme={pseudonyme} data={data} />
      ) : pseudonyme ? null : (
        <p className="empty-state">
          Sélectionne un pseudonyme étudiant pour consulter son index.
        </p>
      )}
    </CourseShell>
  );
}
