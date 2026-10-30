"use client";

import type { CourseManifest, CourseCompletionResponse } from "@/lib/api";
import ChartDataTable from "./ChartDataTable";

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
    <figure className="analytics-figure metric-panel" data-testid="course-progress">
      <figcaption className="analytics-figure__caption">
        <span className="analytics-figure__title">{course.title}</span>
        <span className="analytics-figure__description">
          Complétions indépendantes par leçon, dans l’ordre du parcours.
        </span>
      </figcaption>
      <ol className="course-path">
        {course.lessons.map((l, i) => {
          const n = completion.lessons[l.lesson_id]?.n_completed ?? 0;
          return (
            <li key={l.lesson_id} className="course-lesson" data-testid="course-lesson">
              <div className="course-lesson__heading">
                <span className="course-lesson__title">
                  {i + 1}. {l.title ?? l.lesson_id}
                </span>
                <span className="course-lesson__count">
                  {n} apprenant·e{n > 1 ? "·s" : ""}
                </span>
              </div>
              <div className="course-lesson__bar" aria-hidden="true">
                <span style={{ width: `${Math.round((n / maxN) * 100)}%` }} />
              </div>
              {l.prerequisite_lesson_ids.length > 0 ? (
                <p className="course-lesson__prerequisite">
                  Prérequis : {l.prerequisite_lesson_ids.map((p) => titleOf(course, p)).join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="method-note">
        Compteurs INDÉPENDANTS par leçon : apprenant·e·s distinct·e·s ayant terminé
        chaque leçon ({completion.total_completions} complétion
        {completion.total_completions > 1 ? "s" : ""} au total). Ce ne sont PAS les
        mêmes apprenant·e·s d&apos;une leçon à l&apos;autre — les pseudonymes
        télémétriques sont salés par leçon, donc les ensembles sont disjoints et NON
        comparables comme un flux ou un entonnoir de rétention. Le suivi par individu
        d&apos;une leçon à l&apos;autre ne vit que dans le profil cross-lesson, jamais distribué.
      </p>
      <ChartDataTable
        caption={`Complétions par leçon — ${course.title}`}
        rows={course.lessons.map((lesson, index) => ({
          lesson,
          index,
          n: completion.lessons[lesson.lesson_id]?.n_completed ?? 0,
        }))}
        rowKey={(row) => row.lesson.lesson_id}
        columns={[
          {
            key: "lesson",
            label: "Leçon",
            rowHeader: true,
            render: (row) => `${row.index + 1}. ${row.lesson.title ?? row.lesson.lesson_id}`,
          },
          {
            key: "prerequisites",
            label: "Prérequis",
            render: (row) => row.lesson.prerequisite_lesson_ids.length > 0
              ? row.lesson.prerequisite_lesson_ids.map((id) => titleOf(course, id)).join(", ")
              : "Aucun",
          },
          {
            key: "completed",
            label: "Apprenant·e·s ayant terminé",
            render: (row) => row.n,
          },
        ]}
      />
    </figure>
  );
}
