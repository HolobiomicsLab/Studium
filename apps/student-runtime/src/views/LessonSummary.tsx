import { Link } from "react-router-dom";
import StudyShell from "../components/StudyShell";

export default function LessonSummary() {
  return (
    <StudyShell>
    <main className="summary-page">
      <div className="summary-card">
      <span className="summary-mark" aria-hidden="true">✓</span>
      <p className="eyebrow">Une étape parcourue</p>
      <h1 className="text-2xl font-bold mb-2">Leçon terminée</h1>
      <p className="text-gray-600 mb-6">Bravo ! Tu as terminé cette leçon.</p>
      <Link to="/library" className="button-primary">Retour à la bibliothèque <span aria-hidden="true">↗</span></Link>
      </div>
    </main>
    </StudyShell>
  );
}
