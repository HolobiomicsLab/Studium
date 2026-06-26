"use client";
import { useState } from "react";
import {
  gradeSpotTheFlaw,
  gradeExplainBack,
  type SpotTheFlawScene,
  type ExplainBackScene,
  type CoverageResult,
} from "@/lib/scenes";

// KEY-FREE pre-submit preview for the active-learning scene types whose
// SelfTestPanel (quiz-only) does not apply. The author writes a MOCK free-text
// answer the way a future learner would, presses "Voir le corrigé", and ONLY
// THEN is the answer key revealed — the planted flaws / key points, which of them
// the mock answer caught, and the model reference. Nothing is rendered before the
// author acts (so the answer key cannot be peeked), and nothing is routed to the
// backend / LLM: coverage is graded by the local key-free grader.

function CoverageList({
  result,
  itemLabel,
}: {
  result: CoverageResult;
  itemLabel: string;
}) {
  return (
    <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
      {result.items.map((it) => (
        <li
          key={it.id}
          data-testid={`coverage-${it.id}`}
          data-covered={it.covered ? "yes" : "no"}
          style={{ color: it.covered ? "#1e7e34" : "#b3261e", marginBottom: 4 }}
        >
          {it.covered ? "✓ " : "✗ "}
          <strong>{itemLabel}:</strong> {it.text}
          <span style={{ color: "#777", fontWeight: 400 }}>
            {" "}
            ({it.terms.join(", ")})
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SpotTheFlawRevealPanel({ scene }: { scene: SpotTheFlawScene }) {
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const result = revealed ? gradeSpotTheFlaw(scene, answer) : null;

  return (
    <section
      aria-label="Aperçu avec corrigé"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginTop: "1rem" }}
    >
      <h3 style={{ marginTop: 0 }}>Aperçu (sans clé, en local)</h3>
      <p style={{ color: "#555", marginTop: 0 }}>
        Lis ton cours volontairement erroné, écris ce qui ne va pas, puis révèle le
        corrigé pour vérifier que tes défauts plantés sont bien attrapables.
      </p>
      <p style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{scene.flawed_content}</p>
      <label>
        Ta réponse (les défauts repérés)
        <textarea
          aria-label="réponse de l'apprenant"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%" }}
        />
      </label>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        disabled={revealed}
        style={{ marginTop: 8 }}
      >
        Voir le corrigé
      </button>

      {result && (
        <div data-testid="reveal" style={{ marginTop: "0.75rem" }}>
          <p
            data-testid="coverage-score"
            style={{ fontWeight: 600 }}
          >
            Défauts attrapés : {result.covered} / {result.total}
          </p>
          <CoverageList result={result} itemLabel="Assertion erronée" />
          <details open style={{ marginTop: "0.75rem" }}>
            <summary>Cours corrigé (référence)</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{scene.model_correction}</p>
          </details>
        </div>
      )}
    </section>
  );
}

export function ExplainBackRevealPanel({ scene }: { scene: ExplainBackScene }) {
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const result = revealed ? gradeExplainBack(scene, answer) : null;

  return (
    <section
      aria-label="Aperçu avec corrigé"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginTop: "1rem" }}
    >
      <h3 style={{ marginTop: 0 }}>Aperçu (sans clé, en local)</h3>
      <p style={{ color: "#555", marginTop: 0 }}>
        Réponds à ta consigne avec tes propres mots, puis révèle le corrigé pour
        vérifier que tes idées-clés sont bien couvrables.
      </p>
      <p style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{scene.prompt}</p>
      <label>
        Ton explication
        <textarea
          aria-label="réponse de l'apprenant"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%" }}
        />
      </label>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        disabled={revealed}
        style={{ marginTop: 8 }}
      >
        Voir le corrigé
      </button>

      {result && (
        <div data-testid="reveal" style={{ marginTop: "0.75rem" }}>
          <p data-testid="coverage-score" style={{ fontWeight: 600 }}>
            Idées-clés couvertes : {result.covered} / {result.total}
          </p>
          <CoverageList result={result} itemLabel="Idée-clé" />
          <details open style={{ marginTop: "0.75rem" }}>
            <summary>Explication de référence</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{scene.model_explanation}</p>
          </details>
        </div>
      )}
    </section>
  );
}
