import { Link } from "react-router-dom";

const DEMO_BUNDLE_ID = "demo-metabolomics-001";

export default function LibraryScreen() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Bibliothèque</h1>
          <Link to="/settings" className="text-sm text-blue-600 underline">Réglages</Link>
        </header>
        <div className="bg-white shadow rounded-lg p-6 hover:shadow-md transition">
          <h2 className="text-xl font-semibold">Introduction à la métabolomique LC-MS</h2>
          <p className="text-gray-600 mt-1">Niveau L3 · 30 minutes · 7 scènes</p>
          <Link
            to={`/lesson/${DEMO_BUNDLE_ID}`}
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded"
          >
            Démarrer la leçon
          </Link>
        </div>
      </div>
    </main>
  );
}
