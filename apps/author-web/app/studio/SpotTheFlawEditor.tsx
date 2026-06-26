"use client";
import { useCallback } from "react";

// Guided editor for a spot_the_flaw scene draft. Owns ONLY the type-specific
// fields; the shared title/estimated_seconds and the validation badge live in
// StudioForm. Enforces its client-side invariants by construction: at least one
// claim, each claim with at least one expected flaw (the schema's .min(1) bounds)
// — the "+ flaw" / "remove" affordances keep the answer key well-formed.

export type FlawClaimDraft = { id: string; text: string; flaws_expected: string[] };

export type SpotTheFlawDraft = {
  flawed_content: string;
  claims: FlawClaimDraft[];
  model_correction: string;
};

export function emptyFlawClaim(id: string): FlawClaimDraft {
  return { id, text: "", flaws_expected: [""] };
}

export const initialSpotTheFlawDraft = (): SpotTheFlawDraft => ({
  flawed_content: "",
  claims: [emptyFlawClaim("c1")],
  model_correction: "",
});

const inputStyle = { display: "block", marginTop: 4, padding: "4px 8px", width: "100%" } as const;

export function SpotTheFlawEditor({
  draft,
  onChange,
}: {
  draft: SpotTheFlawDraft;
  onChange: (d: SpotTheFlawDraft) => void;
}) {
  const patch = useCallback(
    (p: Partial<SpotTheFlawDraft>) => onChange({ ...draft, ...p }),
    [draft, onChange]
  );

  const updateClaim = (idx: number, p: Partial<FlawClaimDraft>) =>
    patch({ claims: draft.claims.map((c, i) => (i === idx ? { ...c, ...p } : c)) });

  const addClaim = () =>
    draft.claims.length < 5 &&
    patch({ claims: [...draft.claims, emptyFlawClaim(`c${draft.claims.length + 1}`)] });

  const removeClaim = (idx: number) =>
    draft.claims.length > 1 && patch({ claims: draft.claims.filter((_, i) => i !== idx) });

  const setFlaw = (ci: number, fi: number, value: string) =>
    updateClaim(ci, {
      flaws_expected: draft.claims[ci].flaws_expected.map((f, i) => (i === fi ? value : f)),
    });

  const addFlaw = (ci: number) =>
    updateClaim(ci, { flaws_expected: [...draft.claims[ci].flaws_expected, ""] });

  const removeFlaw = (ci: number, fi: number) =>
    draft.claims[ci].flaws_expected.length > 1 &&
    updateClaim(ci, {
      flaws_expected: draft.claims[ci].flaws_expected.filter((_, i) => i !== fi),
    });

  return (
    <>
      <label>
        Cours volontairement erroné (lu par l&apos;apprenant)
        <textarea
          aria-label="contenu erroné"
          value={draft.flawed_content}
          onChange={(e) => patch({ flawed_content: e.target.value })}
          rows={4}
          style={inputStyle}
        />
      </label>

      <fieldset style={{ border: "1px solid #ddd", borderRadius: 6 }}>
        <legend>Défauts plantés (1 à 5, chacun avec ≥ 1 mot-clé attendu)</legend>
        {draft.claims.map((c, ci) => (
          <div
            key={c.id}
            style={{ border: "1px solid #eee", borderRadius: 4, padding: 8, marginBottom: 8 }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                aria-label={`assertion erronée ${ci + 1}`}
                placeholder="assertion fausse"
                value={c.text}
                onChange={(e) => updateClaim(ci, { text: e.target.value })}
                style={{ flex: 1, padding: "4px 8px" }}
              />
              <button
                type="button"
                aria-label={`retirer l'assertion ${ci + 1}`}
                onClick={() => removeClaim(ci)}
                disabled={draft.claims.length <= 1}
              >
                −
              </button>
            </div>
            <div style={{ marginTop: 6, paddingLeft: 12 }}>
              <span style={{ color: "#555", fontSize: "0.9em" }}>Mots-clés du défaut attendu :</span>
              {c.flaws_expected.map((f, fi) => (
                <div key={fi} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <input
                    aria-label={`défaut attendu ${ci + 1}.${fi + 1}`}
                    value={f}
                    onChange={(e) => setFlaw(ci, fi, e.target.value)}
                    style={{ flex: 1, padding: "4px 8px" }}
                  />
                  <button
                    type="button"
                    aria-label={`retirer le défaut ${ci + 1}.${fi + 1}`}
                    onClick={() => removeFlaw(ci, fi)}
                    disabled={c.flaws_expected.length <= 1}
                  >
                    −
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => addFlaw(ci)} style={{ marginTop: 4 }}>
                + mot-clé
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addClaim} disabled={draft.claims.length >= 5}>
          + Ajouter un défaut
        </button>
      </fieldset>

      <label>
        Cours corrigé (référence, révélé après réponse)
        <textarea
          aria-label="cours corrigé"
          value={draft.model_correction}
          onChange={(e) => patch({ model_correction: e.target.value })}
          rows={4}
          style={inputStyle}
        />
      </label>
    </>
  );
}
