import { ContextHelp } from "@studium/activity-presentation/react";
import "../../../../ui/context-help.css";
import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

/** Shared learner frame; navigation is omitted before consent. */
export default function StudyShell({ children, welcome = false, lesson = false }: { children: ReactNode; welcome?: boolean; lesson?: boolean }) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  return (
    <div className="study-shell">
      <a className="skip-link" href="#study-content">Aller au contenu</a>
      <header className="study-header">
        <div className="study-brand" aria-label="Studium — Espace apprenant">
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
            <rect width="40" height="40" rx="12" fill="currentColor" />
            <path d="M10 11h7c3 0 3 3 3 3s0-3 3-3h7v19h-7c-3 0-3 2-3 2s0-2-3-2h-7zM20 14v18" fill="none" stroke="#f5f2eb" strokeWidth="1.6" />
          </svg>
          <span>Studium<small>Espace apprenant</small></span>
        </div>
        {!welcome && !lesson && (
          <nav aria-label="Navigation principale" className="study-nav">
            <NavLink to="/library">Mes leçons</NavLink>
            <NavLink to="/settings">Réglages</NavLink>
          </nav>
        )}
      </header>
      <div id="study-content" tabIndex={-1}><ContextHelp topic={lesson ? "scaffolding" : "studium"} />{children}</div>
      <footer className="study-footer"><span>Studium</span><span>Observer · Comprendre · Pratiquer</span></footer>
    </div>
  );
}
