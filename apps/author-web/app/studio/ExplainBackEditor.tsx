"use client";
import { useCallback } from "react";

// Guided editor for an explain_back scene draft. Owns ONLY the type-specific
// fields. Enforces its client-side invariants by construction: at least one key
// point, each key point with at least one coverage cue (the schema's .min(1)
// bounds) — so the offline coverage scorer always has something to match.

export type KeyPointDraft = { id: string; text: string; cues: string[] };

export type ExplainBackDraft = {
  prompt: string;
  key_points: KeyPointDraft[];
  model_explanation: string;
};

export function emptyKeyPoint(id: string): KeyPointDraft {
  return { id, text: "", cues: [""] };
}

export const initialExplainBackDraft = (): ExplainBackDraft => ({
  prompt: "",
  key_points: [emptyKeyPoint("k1")],
  model_explanation: "",
});

const inputStyle = { display: "block", marginTop: 4, padding: "4px 8px", width: "100%" } as const;

export function ExplainBackEditor({
  draft,
  onChange,
}: {
  draft: ExplainBackDraft;
  onChange: (d: ExplainBackDraft) => void;
}) {
  const patch = useCallback(
    (p: Partial<ExplainBackDraft>) => onChange({ ...draft, ...p }),
    [draft, onChange]
  );

  const updateKp = (idx: number, p: Partial<KeyPointDraft>) =>
    patch({ key_points: draft.key_points.map((k, i) => (i === idx ? { ...k, ...p } : k)) });

  const addKp = () =>
    draft.key_points.length < 6 &&
    patch({ key_points: [...draft.key_points, emptyKeyPoint(`k${draft.key_points.length + 1}`)] });

  const removeKp = (idx: number) =>
    draft.key_points.length > 1 &&
    patch({ key_points: draft.key_points.filter((_, i) => i !== idx) });

  const setCue = (ki: number, qi: number, value: string) =>
    updateKp(ki, { cues: draft.key_points[ki].cues.map((q, i) => (i === qi ? value : q)) });

  const addCue = (ki: number) =>
    updateKp(ki, { cues: [...draft.key_points[ki].cues, ""] });

  const removeCue = (ki: number, qi: number) =>
    draft.key_points[ki].cues.length > 1 &&
    updateKp(ki, { cues: draft.key_points[ki].cues.filter((_, i) => i !== qi) });

  return (
    <>
      <label>
        Consigne (ce que l&apos;apprenant doit ré-expliquer)
        <textarea
          aria-label="consigne"
          value={draft.prompt}
          onChange={(e) => patch({ prompt: e.target.value })}
          rows={2}
          style={inputStyle}
        />
      </label>

      <fieldset style={{ border: "1px solid #ddd", borderRadius: 6 }}>
        <legend>Idées-clés (1 à 6, chacune avec ≥ 1 indice de couverture)</legend>
        {draft.key_points.map((k, ki) => (
          <div
            key={k.id}
            style={{ border: "1px solid #eee", borderRadius: 4, padding: 8, marginBottom: 8 }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                aria-label={`idée-clé ${ki + 1}`}
                placeholder="idée que l'explication doit contenir"
                value={k.text}
                onChange={(e) => updateKp(ki, { text: e.target.value })}
                style={{ flex: 1, padding: "4px 8px" }}
              />
              <button
                type="button"
                aria-label={`retirer l'idée-clé ${ki + 1}`}
                onClick={() => removeKp(ki)}
                disabled={draft.key_points.length <= 1}
              >
                −
              </button>
            </div>
            <div style={{ marginTop: 6, paddingLeft: 12 }}>
              <span style={{ color: "#555", fontSize: "0.9em" }}>Indices de couverture :</span>
              {k.cues.map((q, qi) => (
                <div key={qi} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <input
                    aria-label={`indice ${ki + 1}.${qi + 1}`}
                    value={q}
                    onChange={(e) => setCue(ki, qi, e.target.value)}
                    style={{ flex: 1, padding: "4px 8px" }}
                  />
                  <button
                    type="button"
                    aria-label={`retirer l'indice ${ki + 1}.${qi + 1}`}
                    onClick={() => removeCue(ki, qi)}
                    disabled={k.cues.length <= 1}
                  >
                    −
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => addCue(ki)} style={{ marginTop: 4 }}>
                + indice
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addKp} disabled={draft.key_points.length >= 6}>
          + Ajouter une idée-clé
        </button>
      </fieldset>

      <label>
        Explication de référence (révélée après réponse)
        <textarea
          aria-label="explication de référence"
          value={draft.model_explanation}
          onChange={(e) => patch({ model_explanation: e.target.value })}
          rows={4}
          style={inputStyle}
        />
      </label>
    </>
  );
}
