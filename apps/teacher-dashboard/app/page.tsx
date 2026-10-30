import { redirect } from "next/navigation";
import Link from "next/link";

async function go(formData: FormData) {
  "use server";
  const token = String(formData.get("courseToken") ?? "").trim();
  if (!token) return;
  redirect(`/courses/${encodeURIComponent(token)}/progress`);
}

export default function Home() {
  return (
    <main className="home-shell" id="contenu" lang="fr">
      <section className="home-intro" aria-labelledby="home-title">
        <p className="eyebrow">Observatoire pédagogique</p>
        <h1 id="home-title">Lire un cours avec justesse.</h1>
        <p className="home-intro__lead">
          Un espace de travail pour suivre les parcours, repérer les points d’attention
          et préparer vos interventions à partir d’indicateurs contextualisés.
        </p>
        <Link className="primary-button home-library-link" href="/library">Bibliothèque de cours <span aria-hidden="true">→</span></Link>
        <ul className="home-principles" aria-label="Principes du tableau de bord">
          <li>
            <strong>Vue d’ensemble</strong>
            <span>Progression et parcours dans une même lecture.</span>
          </li>
          <li>
            <strong>Mesures situées</strong>
            <span>Population et limites restent visibles près des chiffres.</span>
          </li>
          <li>
            <strong>Décisions humaines</strong>
            <span>Les indicateurs éclairent le travail enseignant.</span>
          </li>
        </ul>
      </section>

      <section className="course-entry" aria-labelledby="course-entry-title">
        <p className="eyebrow">Entrer dans l’atelier</p>
        <h2 id="course-entry-title">Ouvrir un cours</h2>
        <p className="course-entry__intro">
          Utilisez l’identifiant transmis avec votre espace de cours.
        </p>
        <form action={go} className="course-entry__form">
          <label className="field">
            <span className="field__label">Identifiant du cours</span>
            <input
              name="courseToken"
              required
              aria-label="Identifiant du cours"
              autoComplete="off"
              placeholder="ex. metabolomics-2026-spring"
              className="field__input"
            />
            <span className="field__hint">
              L’identifiant doit correspondre exactement à celui du cours.
            </span>
          </label>
          <button type="submit" className="primary-button">
            Ouvrir le cours <span aria-hidden="true">→</span>
          </button>
        </form>
        <div className="course-entry__aside">
          <p>Vous animez une séance de révision entre pairs&nbsp;?</p>
          <Link className="button-link" href="/room">
            Gérer une salle
          </Link>
        </div>
      </section>
    </main>
  );
}
