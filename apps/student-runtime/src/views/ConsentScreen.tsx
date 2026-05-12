import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { tauri, ConsentRecord } from "../lib/tauri";

export default function ConsentScreen() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [c, setC] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    if (!a) return;
    const record: ConsentRecord = {
      consent_id: crypto.randomUUID(),
      level_a: a,
      level_b: b,
      level_c: c,
      granted_at: new Date().toISOString(),
    };
    await tauri.setConsent(record);
    navigate("/library", { replace: true });
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full bg-white shadow rounded-lg p-8">
        <h1 className="text-2xl font-bold mb-2">Bienvenue dans Studium</h1>
        <p className="text-gray-600 mb-6">Avant de démarrer, nous avons besoin de ton accord.</p>

        <Item id="a" label="A · Utilisation du cours interactif"
          desc="J'accepte d'utiliser cette plateforme pédagogique. (requis pour continuer)"
          checked={a} onChange={setA} />
        <Item id="b" label="B · Indicateurs anonymisés pour l'enseignant"
          desc="J'accepte que des indicateurs anonymisés sur ma progression soient transmis."
          checked={b} onChange={setB} />
        <Item id="c" label="C · Activités coopératives"
          desc="J'accepte de participer à des activités en groupe (non utilisé en MVP)."
          checked={c} onChange={setC} />

        <p className="text-sm text-gray-500 mt-4">Tu peux modifier ces choix à tout moment dans Réglages.</p>

        <div className="flex gap-3 mt-6 justify-end">
          <button className="px-4 py-2 rounded border" onClick={() => window.close()}>Annuler</button>
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white disabled:bg-gray-300"
            disabled={!a}
            onClick={submit}
          >
            Continuer
          </button>
        </div>
      </div>
    </main>
  );
}

function Item({ id, label, desc, checked, onChange }: {
  id: string;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 mb-4 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-sm text-gray-500">{desc}</div>
      </div>
    </label>
  );
}
