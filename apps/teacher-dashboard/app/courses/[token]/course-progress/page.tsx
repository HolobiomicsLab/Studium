import { getCourse, getCourseCompletion, type CourseManifest, type CourseCompletionResponse } from "@/lib/api";
import CourseProgress from "@/components/CourseProgress";
import CourseNav from "@/components/CourseNav";

export const dynamic = "force-dynamic";

type Props = {
  params: { token: string };
  searchParams: { course_ref?: string };
};

export default async function CourseProgressPage({ params, searchParams }: Props) {
  const token = decodeURIComponent(params.token);
  const courseRef = searchParams.course_ref;

  let completion: CourseCompletionResponse | undefined;
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
    <main className="max-w-5xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-2">
        Cours <code className="text-base">{token}</code>
      </h1>
      <CourseNav token={token} active="course-progress" />
      <h2 className="text-lg font-semibold mb-4">Complétion par leçon du parcours</h2>
      {error ? <p className="text-red-600">Erreur API : {error}</p> : null}
      {course && completion ? (
        <CourseProgress course={course} completion={completion} />
      ) : completion ? (
        <div className="space-y-3">
          {!courseRef ? (
            <p className="text-sm text-gray-600">
              Ajouter <code>?course_ref=courses/&lt;manifeste&gt;.json</code> à l&apos;URL
              pour superposer la colonne du parcours (ordre + prérequis). Sans manifeste,
              voici les compteurs bruts de complétion par leçon :
            </p>
          ) : manifestError ? (
            <p className="text-amber-600 text-sm">
              Manifeste de cours introuvable ({manifestError}). Compteurs bruts :
            </p>
          ) : null}
          <ul className="space-y-1" data-testid="raw-completion-counts">
            {Object.entries(completion.lessons).map(([lessonId, c]) => (
              <li key={lessonId} className="flex justify-between border-b py-1 text-sm">
                <code>{lessonId}</code>
                <span className="tabular-nums text-gray-600">
                  {c.n_completed} apprenant·e{c.n_completed > 1 ? "·s" : ""}
                </span>
              </li>
            ))}
            {Object.keys(completion.lessons).length === 0 ? (
              <li className="text-sm text-gray-500">Aucune leçon terminée pour l&apos;instant.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </main>
  );
}
