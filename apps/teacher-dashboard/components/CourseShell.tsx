import type { ReactNode } from "react";
import Link from "next/link";
import CourseNav, { type CourseDestination } from "./CourseNav";
import { ContextHelp } from '@studium/activity-presentation/react';

const HELP_TOPICS = {
  progress: 'mastery', 'course-progress': 'mastery', calibration: 'confidence',
  'trust-calibration': 'critical', autonomy: 'scaffolding', trajectory: 'mastery',
  'ai-literacy': 'critical', reasoning: 'reflection', journal: 'trace',
  cooperation: 'reflection', blueprint: 'objective', submissions: 'review',
} as const;

type Props = {
  token: string;
  active: CourseDestination;
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
};

/** Gives every course view the same course identity, navigation, and heading order. */
export default function CourseShell({
  token,
  active,
  eyebrow,
  title,
  description,
  children,
}: Props) {
  return (
    <main className="course-shell" id="contenu">
      <aside className="course-rail">
        <div className="course-identity">
          <span className="eyebrow">Cours actif</span>
          <h1>
            Cours <code>{token}</code>
          </h1>
        </div>
        <CourseNav token={token} active={active} />
        <Link className="course-return" href="/">
          <span aria-hidden="true">←</span> Changer de cours
        </Link>
      </aside>

      <article className="course-page">
        <header className="page-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <ContextHelp topic={HELP_TOPICS[active]} audience="teacher" />
          {description ? <div className="page-heading__description">{description}</div> : null}
        </header>
        <div className="content-stack">{children}</div>
      </article>
    </main>
  );
}
