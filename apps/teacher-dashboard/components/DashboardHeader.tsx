import Link from "next/link";
import { messages, type Locale } from "@/lib/i18n";
import { updatePreferences } from "@/app/preferences";
import SignOutButton from "@/components/SignOutButton";

/** "open": no access code configured; otherwise whether this browser holds a valid session. */
export type DashboardAccess = "open" | "signed-in" | "signed-out";

/** Global identity and shortcuts shared by every teacher-facing route. */
export default function DashboardHeader({ locale = "fr", theme = "system", access = "open" }: { locale?: Locale; theme?: string; access?: DashboardAccess }) {
  const t = messages(locale);
  return (
    <header className="site-header">
      {access === "open" && <p className="open-notice" role="note" data-testid="open-notice">{t.openNotice}</p>}
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label={`Studium — ${t.teacherSpace}`}>
          <span className="brand__mark" aria-hidden="true">
            {/* Monochrome paths from docs/assets/brand/studium-mark-mono.svg (V1). */}
            <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor" focusable="false">
              <path d="M18 3.875H9a4.625 4.625 0 0 0 0 9.25h6a2.375 2.375 0 0 1 0 4.75H6v2.25h9a4.625 4.625 0 0 0 0-9.25H9a2.375 2.375 0 0 1 0-4.75h9Z"/>
              <path d="M20.5 5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0ZM8.5 19a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0Z"/>
              <path d="M14.25 12a2.25 2.25 0 1 1-4.5 0a2.25 2.25 0 1 1 4.5 0Z"/>
            </svg>
          </span>
          <span className="brand__text">
            <strong>Studium</strong>
            <span>{t.teacherSpace}</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label={t.navigation}>
          <Link className="site-nav__link" href="/">
            {t.home}
          </Link>
          <Link className="site-nav__link" href="/library">{t.library}</Link>
          <Link className="site-nav__link" href="/room">
            {t.room}
          </Link>
          <details className="preferences">
            <summary>{t.appearance}</summary>
            <form action={updatePreferences} className="preferences__form">
              <label>{t.language}<select name="locale" defaultValue={locale}><option value="fr">Français</option><option value="en">English</option></select></label>
              <label>{t.theme}<select name="theme" defaultValue={theme}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select></label>
              <button className="primary-button" type="submit">{t.apply}</button>
            </form>
          </details>
          {access === "signed-in" && <SignOutButton label={t.signOut} />}
        </nav>
      </div>
    </header>
  );
}
