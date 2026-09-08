"use client";

import type { CourseManifest, CourseCompletionResponse } from "@/lib/api";

type Props = { course: CourseManifest; completion: CourseCompletionResponse };

function titleOf(course: CourseManifest, lessonId: string): string {
  return course.lessons.find((l) => l.lesson_id === lessonId)?.title ?? lessonId;
}

// Renders the course spine (lessons in curriculum order + prerequisites) annotated
// with INDEPENDENT per-lesson completion counts: distinct learners who completed
// each lesson. NOT a funnel — the per-lesson completer sets are disjoint and not
// comparable as a flow (telemetry pseudonyms are salted per lesson). The bar is a
// neutral per-lesson magnitude (vs the most-completed lesson), never a retention fill.
export default function CourseProgress({ course, completion }: Props) {
  const counts = course.lessons.map((l) => completion.lessons[l.lesson_id]?.n_completed ?? 0);
  const maxN = Math.max(1, ...counts);
  return (
    <div className="space-y-4" data-testid="course-progress">
      <h3 className="font-semibold">{course.title}</h3>
      <ol className="space-y-3">
        {course.lessons.map((l, i) => {
          const n = completion.lessons[l.lesson_id]?.n_completed ?? 0;
          return (
            <li key={l.lesson_id} className="border rounded p-3" data-testid="course-lesson">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {i + 1}. {l.title ?? l.lesson_id}
                </span>
                <span className="text-sm tabular-nums text-gray-600">
                  {n} apprenant·e{n > 1 ? "·s" : ""}
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-gray-100 rounded" aria-hidden>
                <div
                  className="h-1.5 bg-gray-400 rounded"
                  style={{ width: `${Math.round((n / maxN) * 100)}%` }}
                />
              </div>
              {l.prerequisite_lesson_ids.length > 0 ? (
                <p className="mt-1 text-xs text-gray-500">
                  Prérequis : {l.prerequisite_lesson_ids.map((p) => titleOf(course, p)).join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-gray-400">
        Compteurs INDÉPENDANTS par leçon : apprenant·e·s distinct·e·s ayant terminé
        chaque leçon ({completion.total_completions} complétion
        {completion.total_completions > 1 ? "s" : ""} au total). Ce ne sont PAS les
        mêmes apprenant·e·s d&apos;une leçon à l&apos;autre — les pseudonymes
        télémétriques sont salés par leçon, donc les ensembles sont disjoints et NON
        comparables comme un flux ou un entonnoir de rétention. Le suivi par individu
        d&apos;une leçon à l&apos;autre ne vit que dans le profil cross-lesson, jamais distribué.
      </p>
    </div>
  );
}
