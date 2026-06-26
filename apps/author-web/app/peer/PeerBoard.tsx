"use client";
import { useCallback, useEffect, useState } from "react";
import { listSubmittedItems, type LearnerItemView } from "@/lib/api";
import { PeerTakePanel } from "./PeerTakePanel";
import { PeerRatePanel } from "./PeerRatePanel";

// Demo course context (the backend hardcodes the same id; peer ratings MUST be
// scoped to it).
const COURSE_ID = "atomistique-l1";

const SCENE_LABELS: Record<string, string> = {
  quiz: "Quiz (QCM)",
  spot_the_flaw: "Repérer l'erreur",
  explain_back: "Ré-expliquer",
};

export type PeerBoardProps = {
  // Injectable for tests; defaults to the real :8002 client function.
  listFn?: typeof listSubmittedItems;
};

export function PeerBoard({ listFn = listSubmittedItems }: PeerBoardProps) {
  const [items, setItems] = useState<LearnerItemView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LearnerItemView | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setItems(null);
    try {
      // Discovery queue: only 'submitted' items, never the author identity.
      const list = await listFn({ course: COURSE_ID, state: "submitted" });
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [listFn]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (selected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 640 }}>
        <button
          type="button"
          onClick={() => setSelected(null)}
          style={{ alignSelf: "flex-start" }}
        >
          ← Retour à la liste
        </button>
        <h2 style={{ marginBottom: 0 }}>{selected.scene.title}</h2>
        <p style={{ color: "#777", marginTop: 0 }}>
          {SCENE_LABELS[selected.scene.type] ?? selected.scene.type} · auteur anonyme
        </p>
        <PeerTakePanel scene={selected.scene} />
        <PeerRatePanel itemId={selected.item_id} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 640 }}>
      <p style={{ color: "#555" }}>
        Choisis l&apos;item d&apos;un camarade à tester. Tu réponds comme un apprenant,
        puis tu notes sa qualité. Tu ne vois jamais qui l&apos;a écrit, et ta note est
        agrégée de façon anonyme.
      </p>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {!items && !error && <p>Chargement…</p>}
      {items && items.length === 0 && (
        <p data-testid="peer-empty">Aucun item à tester pour le moment.</p>
      )}

      {items && items.length > 0 && (
        <ul data-testid="peer-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => (
            <li
              key={it.item_id}
              data-testid={`peer-item-${it.item_id}`}
              style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem" }}
            >
              <div style={{ fontWeight: 600 }}>{it.scene.title}</div>
              <div style={{ color: "#777", fontSize: "0.9rem" }}>
                {SCENE_LABELS[it.scene.type] ?? it.scene.type}
              </div>
              <button
                type="button"
                onClick={() => setSelected(it)}
                style={{
                  marginTop: 8,
                  padding: "6px 12px",
                  background: "#0070f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Tester cet item
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
