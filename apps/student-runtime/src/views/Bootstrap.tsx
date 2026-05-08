import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { tauri } from "../lib/tauri";

export default function Bootstrap() {
  const navigate = useNavigate();
  useEffect(() => {
    tauri.getConsent()
      .then((c) => {
        if (!c || !c.level_a) navigate("/consent", { replace: true });
        else navigate("/library", { replace: true });
      })
      .catch(() => navigate("/consent", { replace: true }));
  }, [navigate]);
  return (
    <main className="min-h-screen flex items-center justify-center">
      <p className="text-gray-500">Chargement…</p>
    </main>
  );
}
