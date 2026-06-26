"use client";
import { useState } from "react";
import { submitPeerReview } from "@/lib/api";

// The rating form. SCALARS ONLY — {passed, rating(1-5), helpful}. There is NO
// free-text field and NO peer-identity field anywhere in this form, mirroring
// the backend's extra='forbid' on LearnerPeerReviewRequest: a peer rating is
// anonymous and aggregated. On success we show a thank-you that states the
// ratings are pooled anonymously and the author never sees who rated.
export type PeerRatePanelProps = {
  itemId: string;
  submitFn?: typeof submitPeerReview;
};

export function PeerRatePanel({ itemId, submitFn = submitPeerReview }: PeerRatePanelProps) {
  const [passed, setPassed] = useState<boolean | null>(null);
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [helpful, setHelpful] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = passed !== null && rating !== null && !submitting && !done;

  async function handleSubmit() {
    if (passed === null || rating === null) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitFn({ itemId, passed, rating, helpful });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p role="status" data-testid="peer-thank-you" style={{ color: "#1e7e34", fontWeight: 600 }}>
        Merci ! Ta note a été enregistrée. Les évaluations sont agrégées de façon
        anonyme — l&apos;auteur ne voit jamais qui a noté.
      </p>
    );
  }

  return (
    <section
      aria-label="Noter l'item"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginTop: "1rem" }}
    >
      <h3 style={{ marginTop: 0 }}>Ton évaluation (anonyme)</h3>

      <fieldset style={{ border: "1px solid #eee", borderRadius: 6, marginBottom: 8 }}>
        <legend>Ton test est-il concluant ?</legend>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name="peer-passed"
            aria-label="test réussi"
            checked={passed === true}
            onChange={() => setPassed(true)}
          />
          <span>Oui — l&apos;item fonctionne</span>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="radio"
            name="peer-passed"
            aria-label="test échoué"
            checked={passed === false}
            onChange={() => setPassed(false)}
          />
          <span>Non — l&apos;item pose problème</span>
        </label>
      </fieldset>

      <fieldset style={{ border: "1px solid #eee", borderRadius: 6, marginBottom: 8 }}>
        <legend>Qualité (1 à 5)</legend>
        <div role="radiogroup" aria-label="note de qualité" style={{ display: "flex", gap: 12 }}>
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <label key={n} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="radio"
                name="peer-rating"
                aria-label={`note ${n}`}
                checked={rating === n}
                onChange={() => setRating(n)}
              />
              <span>{n}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
        <input
          type="checkbox"
          aria-label="item utile"
          checked={helpful}
          onChange={(e) => setHelpful(e.target.checked)}
        />
        <span>J&apos;ai trouvé cet item utile</span>
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          padding: "8px 16px",
          background: canSubmit ? "#0070f3" : "#bbb",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        {submitting ? "Envoi…" : "Envoyer ma note"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}
    </section>
  );
}
