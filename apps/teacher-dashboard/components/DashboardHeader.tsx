import Link from "next/link";

/** Global identity and shortcuts shared by every teacher-facing route. */
export default function DashboardHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="Studium — accueil enseignant">
          <span className="brand__mark" aria-hidden="true">
            S
          </span>
          <span className="brand__text">
            <strong>Studium</strong>
            <span>Espace enseignant</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Navigation principale">
          <Link className="site-nav__link" href="/">
            Accueil
          </Link>
          <Link className="site-nav__link" href="/room">
            Salle pair-à-pair
          </Link>
        </nav>
      </div>
    </header>
  );
}
