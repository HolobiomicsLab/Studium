import Link from "next/link";
import { listLessons, type LibraryIndex } from "@/lib/library";
import { requestLocale } from "@/lib/request-locale";
import { counted, messages } from "@/lib/i18n";
import LessonStatus from "@/components/LessonStatus";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: `${messages(await requestLocale()).library} — Studium` };
}

export default async function LibraryPage() {
  const locale = await requestLocale();
  const t = messages(locale);
  let library: LibraryIndex | undefined;
  try { library = await listLessons(); } catch { /* Render an actionable local filesystem error. */ }
  return (
    <main id="contenu" className="library-shell">
      <header className="library-hero">
        <div>
          <p className="eyebrow">{t.libraryEyebrow}</p>
          <h1>{t.library}</h1>
          <p className="library-hero__title">{t.libraryTitle}</p>
          <p className="library-hero__lead">{t.libraryLead}</p>
        </div>
        {library && <dl className="library-totals" aria-label={t.status}>
          <div><dt>{t.courseCount}</dt><dd>{library.lessons.length}</dd></div>
          <div><dt>{t.checkedCount}</dt><dd>{library.lessons.filter((lesson) => lesson.status === "checked").length}</dd></div>
          <div><dt>{t.approvedCount}</dt><dd>{library.lessons.filter((lesson) => lesson.status === "approved").length}</dd></div>
        </dl>}
      </header>
      {!library ? <section className="notice notice--error" role="alert"><div className="notice__body"><h2>{t.libraryError}</h2><p>{t.libraryErrorHelp}</p></div></section> : <>
        <div className="library-toolbar"><h2>{t.lessons}</h2><PrintButton label={t.print} /></div>
        {library.lessons.length === 0 ? <div className="empty-state"><h2>{t.noLessons}</h2><p>{t.noLessonsHelp}</p></div> :
          <ol className="lesson-list">
            {library.lessons.map((lesson, index) => <li key={lesson.ref} className="lesson-row">
              <span className="lesson-row__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className="lesson-row__body">
                <div className="lesson-row__heading"><h3><Link href={`/library/${lesson.routeId}/review`}>{lesson.title}</Link></h3><LessonStatus status={lesson.status} locale={locale} /></div>
                <ul className="lesson-meta" aria-label={t.authoring}>
                  <li><span className="language-tag">{lesson.language.toUpperCase()}</span></li>
                  <li>{lesson.authoringMode === "self_study" ? t.selfStudy : lesson.authoringMode === "teacher" ? t.teacher : t.unknown}</li>
                  <li>{counted(lesson.sceneCount, t.sceneOne, t.scenes, locale)}</li><li>{counted(lesson.conceptCount, t.conceptOne, t.concepts, locale)}</li>
                  {lesson.durationMinutes !== null && <li>{lesson.durationMinutes} {t.minutes}</li>}
                </ul>
                <ul className="key-mix" aria-label={t.keyClasses}>{Object.entries(lesson.keyClasses).filter(([, count]) => count > 0).map(([key, count]) => <li key={key} className={`key-mix__item key-mix__item--${key}`}>{t[key as keyof typeof t] ?? key} <b>{count}</b></li>)}</ul>
              </div>
              <Link className="review-link" href={`/library/${lesson.routeId}/review`} aria-label={`${t.review} : ${lesson.title}`}>{t.review}<span aria-hidden="true">↗</span></Link>
            </li>)}
          </ol>}
        <p className="library-status-help">{t.statusHelp}</p>
        {library.issues.length > 0 && <details className="library-issues"><summary>{t.unreadable} ({library.issues.length})</summary><p>{t.unreadableHelp}</p><ul>{library.issues.map((issue, i) => <li key={`${issue}-${i}`}><code>{issue}</code></li>)}</ul></details>}
      </>}
    </main>
  );
}
