import { useEffect, useState } from "react";
import { journalCreate, journalList, journalUpdate } from "../lib/tauri";

type EmitFn = (e: {
  type: "journal_entry_submitted";
  scene_id: string;
  entry_length: number;
  revision_count: number;
  is_revision: boolean;
}) => void;

type Props = {
  sceneId: string;
  emit?: EmitFn;
};

export default function JournalEntry({ sceneId, emit }: Props) {
  const [text, setText] = useState("");
  const [entryId, setEntryId] = useState<number | null>(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    journalList(sceneId).then((entries) => {
      if (cancelled || entries.length === 0) return;
      const last = entries[entries.length - 1];
      setEntryId(last.id);
      setText(last.content_encrypted);
      setRevisionCount(last.revision_index);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const save = async () => {
    setSaving(true);
    try {
      if (entryId === null) {
        const newId = await journalCreate(sceneId, text);
        setEntryId(newId);
        emit?.({
          type: "journal_entry_submitted",
          scene_id: sceneId,
          entry_length: text.length,
          revision_count: 0,
          is_revision: false,
        });
      } else {
        await journalUpdate(entryId, text);
        const newCount = revisionCount + 1;
        setRevisionCount(newCount);
        emit?.({
          type: "journal_entry_submitted",
          scene_id: sceneId,
          entry_length: text.length,
          revision_count: newCount,
          is_revision: true,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
      <h3 className="text-md font-semibold mb-2">Journal d'apprentissage</h3>
      <p className="text-xs text-gray-500 mb-2">
        Ton texte reste local. Seuls les compteurs (longueur, révisions) sont
        transmis à l'enseignant.
      </p>
      <textarea
        className="w-full border rounded p-2 text-sm"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Note tes réflexions sur cette scène…"
      />
      <button
        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
        disabled={saving || !text.trim()}
        onClick={save}
      >
        {saving ? "Sauvegarde…" : "Sauvegarder"}
      </button>
      {revisionCount > 0 && (
        <p className="text-xs text-gray-400 mt-1">{revisionCount} révision(s)</p>
      )}
    </section>
  );
}
