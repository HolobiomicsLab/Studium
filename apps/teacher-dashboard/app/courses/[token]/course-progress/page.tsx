import { getCourse, getCourseCompletion, isSuppressed, type CourseManifest, type CourseCompletionResponse, type Suppressed } from "@/lib/api";
import CourseProgress from "@/components/CourseProgress";
import CourseShell from "@/components/CourseShell";
import DashboardNotice, { ApiError } from "@/components/DashboardNotice";
import SuppressedNotice from "@/components/SuppressedNotice";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { course_ref?: string };
};

export default async function CourseProgressPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const courseRef = searchParams.course_ref;

  let completion: CourseCompletionResponse | Suppressed | undefined;
  let course: CourseManifest | undefined;
  let error: string | null = null;
  let manifestError: string | null = null;

  try {
    completion = await getCourseCompletion(token);
  } catch (e) {
    error = (e as Error).message;
  }
  if (courseRef) {
    try {
      course = await getCourse(courseRef);
    } catch (e) {
      manifestError = (e as Error).message;
    }
  }

  return (
    <CourseShell
      token={token}
      active="course-progress"
      eyebrow="Vue d’ensemble"
      title="Complétion par leçon du parcours"
      description="Les compteurs restent indépendants d’une leçon à l’autre et ne décrivent pas un entonnoir de rétention."
    >
      {error ? <ApiError message={error} /> : null}
      {isSuppressed(completion) ? <SuppressedNotice info={completion} /> : null}
      {course && completion && !isSuppressed(completion) ? (
        <CourseProgress course={course} completion={completion} />
      ) : completion && !isSuppressed(completion) ? (
        <section className="metric-panel">
          {!courseRef ? (
            <DashboardNotice title="Parcours non associé">
              <p>
                Ajouter <code>?course_ref=courses/&lt;manifeste&gt;.json</code> à l&apos;URL
                pour superposer la colonne du parcours (ordre + prérequis). Sans manifeste,
                voici les compteurs bruts de complétion par leçon :
              </p>
            </DashboardNotice>
          ) : manifestError ? (
            <DashboardNotice title="Manifeste de cours introuvable" tone="caution">
              <p>{manifestError}. Les compteurs bruts restent disponibles ci-dessous.</p>
            </DashboardNotice>
          ) : null}
          <ul className="data-list" data-testid="raw-completion-counts">
            {Object.entries(completion.lessons).map(([lessonId, c]) => (
              <li key={lessonId} className="data-list__row">
                <code>{lessonId}</code>
                <span className="data-list__meta">
                  {c.n_completed} apprenant·e{c.n_completed > 1 ? "·s" : ""}
                </span>
              </li>
            ))}
            {Object.keys(completion.lessons).length === 0 ? (
              <li className="empty-state">Aucune leçon terminée pour l&apos;instant.</li>
            ) : null}
          </ul>
        </section>
      ) : error ? null : (
        <p className="empty-state">Aucune donnée de parcours disponible.</p>
      )}
    </CourseShell>
  );
}
