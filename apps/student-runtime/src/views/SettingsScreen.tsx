import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { tauri } from "../lib/tauri";
import { useTelemetry } from "../hooks/useTelemetry";

const DEMO_BUNDLE_ID = "demo-metabolomics-001";

export default function SettingsScreen() {
  const [pseudo, setPseudo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const { emit, flush } = useTelemetry({
    endpoint: null,
    courseToken: "",
    context: {
      learner_pseudonym: pseudo || "anonymous",
      lesson_id: DEMO_BUNDLE_ID,
      bundle_version: "_settings",
    },
  });

  useEffect(() => {
    tauri.getPseudonyme(DEMO_BUNDLE_ID).then(setPseudo).catch(() => {});
  }, []);

  const wipe = async () => {
    // Emit + flush *before* deleting data so the forget request is recorded
    emit({ type: "forget_requested" });
    try {
      await flush();
    } catch {
      /* swallow — best effort */
    }
    await tauri.deleteAllData();
    navigate("/consent", { replace: true });
  };

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-4">Réglages › Mes données</h1>
        <p className="mb-2">Ton pseudonyme pour ce cours :</p>
        <code className="block bg-gray-100 p-2 rounded text-xs break-all">{pseudo || "…"}</code>
        <hr className="my-6" />
        <h2 className="text-xl font-semibold text-red-700">Effacer mes données</h2>
        <p className="text-sm text-gray-600 my-2">
          Ceci supprimera ton pseudonyme, ton historique, tes états par concept,
          et l'écran de consentement. Tu pourras redémarrer comme nouveau utilisateur.
        </p>
        {!confirming ? (
          <button
            className="px-4 py-2 bg-red-600 text-white rounded"
            onClick={() => setConfirming(true)}
          >
            Effacer mes données
          </button>
        ) : (
          <div className="flex gap-2">
            <button className="px-4 py-2 border rounded" onClick={() => setConfirming(false)}>
              Annuler
            </button>
            <button className="px-4 py-2 bg-red-600 text-white rounded" onClick={wipe}>
              Oui, tout effacer
            </button>
          </div>
        )}
        <hr className="my-6" />
        <Link to="/library" className="text-blue-600 underline">Retour à la bibliothèque</Link>
      </div>
    </main>
  );
}
