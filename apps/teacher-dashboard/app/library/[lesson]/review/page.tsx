import Link from "next/link";
import { notFound } from "next/navigation";
import { approvalCommand, bundlesRoot, decodeLessonRef, LibraryReadError, readLesson, type LibraryLesson } from "@/lib/library";
import { requestLocale } from "@/lib/request-locale";
import { counted, messages, sceneTypeLabel } from "@/lib/i18n";
import { observatoryLink } from "@/lib/observatory-link";
import LessonStatus from "@/components/LessonStatus";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: `${messages(await requestLocale()).review} — Studium` };
}

export default async function ReviewPage({ params }: { params: { lesson: string } }) {
  const locale = await requestLocale();
  const t = messages(locale);
  let ref: string;
  try { ref = decodeLessonRef(params.lesson); } catch { notFound(); }
  let lesson: LibraryLesson;
  try { lesson = await readLesson(bundlesRoot(), ref); }
  catch (error) {
    if (error instanceof LibraryReadError && error.kind === "not-found") notFound();
    const rootUnavailable = error instanceof LibraryReadError && error.kind === "root-unavailable";
    return <main id="contenu" className="library-shell">
      <Link className="breadcrumb" href="/library">← {t.backLibrary}</Link>
      <section className="notice notice--error" role="alert">
        <div className="notice__body"><h1>{rootUnavailable ? t.libraryError : t.lessonUnreadable}</h1>
          <p>{rootUnavailable ? t.libraryErrorHelp : t.lessonUnreadableHelp}</p></div>
      </section>
    </main>;
  }
  const observatory = await observatoryLink(lesson.ref);
  return (
    <main id="contenu" className="library-shell review-shell">
      <Link className="breadcrumb" href="/library"><span aria-hidden="true">←</span> {t.backLibrary}</Link>
      <header className="review-heading">
        <p className="eyebrow">{t.reviewEyebrow}</p><h1>{lesson.title}</h1>
        <p className="review-heading__lead">{t.reviewLead}</p>
        <div className="review-heading__meta"><LessonStatus status={lesson.status} locale={locale} /><span>{lesson.language.toUpperCase()} · {counted(lesson.sceneCount, t.sceneOne, t.scenes, locale)} · {counted(lesson.conceptCount, t.conceptOne, t.concepts, locale)}</span><PrintButton label={t.print} /></div>
      </header>
      <div className="review-grid">
        <section aria-labelledby="outline-heading" className="review-outline">
          <header className="section-heading"><h2 id="outline-heading">{t.outline}</h2><p>{t.outlineHelp}</p></header>
          <ol className="outline-list">{lesson.outline.map((scene, index) => <li key={`${scene.id}-${index}`} className="outline-scene">
            <span className="outline-scene__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div><span className="scene-type">{sceneTypeLabel(scene.type, locale)}</span><h3>{scene.title}</h3>
              <p className="outline-scene__concepts">{scene.concepts.length > 0 ? scene.concepts.join(" · ") : t.noConcepts}</p>
              <details className="scene-sources"><summary>{t.sources} <span>({scene.sources.length})</span></summary>
                {scene.sources.length > 0 ? <ul>{scene.sources.map((source, i) => <li key={i}>{source.url ? <a href={source.url} rel="noreferrer">{source.title}</a> : source.title}</li>)}</ul> : <p>{t.noSources}</p>}
              </details>
            </div>
          </li>)}</ol>
        </section>
        <aside className="review-sidebar" aria-label={t.reviewReadiness}>
          <section className="readiness-panel"><p className="eyebrow">{t.reviewReadiness}</p><dl className="readiness-counts"><div><dt>{t.remaining}</dt><dd>{lesson.todoCount}</dd></div><div><dt>{t.schemaIssues}</dt><dd>{lesson.schemaIssueCount}</dd></div></dl>
            <p className="readiness-note">{t.statusHelp}</p>
            {lesson.approval.matches ? <div className="approval-receipt"><h3>{t.approvalRecorded}</h3>{lesson.approval.reviewer && <p>{t.reviewer} : {lesson.approval.reviewer}</p>}{lesson.approval.reviewedAt && <p>{t.reviewedAt} : <time dateTime={lesson.approval.reviewedAt}>{lesson.approval.reviewedAt}</time></p>}</div> : <p className="approval-note">{lesson.approval.recorded ? t.staleApproval : t.noApproval}</p>}
          </section>
          <section className="approval-panel"><h2>{t.approvalHeading}</h2>
            {lesson.authoringMode === "self_study" ? <p className="approval-note">{t.selfStudyApproval}</p> : <>
              <p>{t.approvalHelp}</p>
              <pre className="approval-command"><code>{approvalCommand(lesson.bundlePath, locale)}</code></pre>
            </>}
            <p className="readiness-note">{t.approvalNotice}</p>
          </section>
          <section className="observatory-panel"><h2>MySTRA</h2>
            {observatory.state === "ready" ? <a className="button-link" href={observatory.href}>{t.mystra}<span aria-hidden="true">↗</span></a> : <><p>{observatory.state === "missing" ? t.observatoryMissing : t.observatoryUnavailable}</p>{observatory.href && <a className="button-link" href={observatory.href}>{t.observatory}</a>}</>}
          </section>
        </aside>
      </div>
    </main>
  );
}
