import { Link } from "react-router-dom";

export default function LessonSummary() {
  return (
    <main className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Leçon terminée</h1>
      <p className="text-gray-600 mb-6">Bravo ! Tu as terminé cette leçon.</p>
      <Link to="/library" className="text-blue-600 underline">Retour à la bibliothèque</Link>
    </main>
  );
}
