"use client";
import { useState } from "react";
import { gradeQuizChoice, type QuizScene } from "@/lib/quiz-scene";
import {
  gradeSpotTheFlaw,
  gradeExplainBack,
  type SpotTheFlawScene,
  type ExplainBackScene,
  type CoverageResult,
} from "@/lib/scenes";
import type { Scene } from "@/lib/api";

// KEY-FREE peer take. A classmate TAKES the submitted item exactly the way the
// /studio author previews their own draft: the quiz is answer-driven
// (gradeQuizChoice), spot_the_flaw / explain_back reveal coverage only AFTER a
// mock answer. NOTHING here is routed to the backend / LLM — grading is local
// and key-free (no API key, no Node-only SessionHost). The peer never sees who
// authored the item: the panel only receives the client-safe Scene, which
// carries no author identity.

function QuizTake({ scene }: { scene: QuizScene }) {
  const [picked, setPicked] = useState<string | null>(null);
  const result = picked ? gradeQuizChoice(scene, picked) : null;

  return (
    <div>
      <p style={{ fontWeight: 600 }}>{scene.question}</p>
      <div role="radiogroup" aria-label="choix" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {scene.choices.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="peer-take-choice"
              value={c.id}
              checked={picked === c.id}
              onChange={() => setPicked(c.id)}
            />
            <span>{c.text || <em style={{ color: "#999" }}>(choix vide)</em>}</span>
          </label>
        ))}
      </div>
      {result && (
        <p
          role="status"
          data-testid="peer-take-feedback"
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem",
            borderRadius: 4,
            background: result.correct ? "#e6f4ea" : "#fdecea",
            color: result.correct ? "#1e7e34" : "#b3261e",
          }}
        >
          {result.correct ? "✓ Correct — " : "✗ Incorrect — "}
          {result.feedback}
        </p>
      )}
    </div>
  );
}

function CoverageList({ result }: { result: CoverageResult }) {
  return (
    <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
      {result.items.map((it) => (
        <li
          key={it.id}
          data-testid={`peer-coverage-${it.id}`}
          data-covered={it.covered ? "yes" : "no"}
          style={{ color: it.covered ? "#1e7e34" : "#b3261e", marginBottom: 4 }}
        >
          {it.covered ? "✓ " : "✗ "}
          {it.text}
        </li>
      ))}
    </ul>
  );
}

function FreeTextTake({
  prompt,
  grade,
  reference,
  referenceLabel,
  coverageLabel,
}: {
  prompt: string;
  grade: (answer: string) => CoverageResult;
  reference: string;
  referenceLabel: string;
  coverageLabel: string;
}) {
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const result = revealed ? grade(answer) : null;

  return (
    <div>
      <p style={{ fontWeight: 600, whiteSpace: "pre-wrap" }}>{prompt}</p>
      <label>
        Ta réponse
        <textarea
          aria-label="ta réponse"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          style={{ display: "block", marginTop: 4, padding: "4px 8px", width: "100%" }}
        />
      </label>
      <button type="button" onClick={() => setRevealed(true)} disabled={revealed} style={{ marginTop: 8 }}>
        Voir le corrigé
      </button>
      {result && (
        <div data-testid="peer-reveal" style={{ marginTop: "0.75rem" }}>
          <p data-testid="peer-coverage-score" style={{ fontWeight: 600 }}>
            {coverageLabel} : {result.covered} / {result.total}
          </p>
          <CoverageList result={result} />
          <details open style={{ marginTop: "0.75rem" }}>
            <summary>{referenceLabel}</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{reference}</p>
          </details>
        </div>
      )}
    </div>
  );
}

// Dispatches to the per-type take UI. Exported so the rating panel can require
// the peer to have taken the item first.
export function PeerTakePanel({ scene }: { scene: Scene }) {
  return (
    <section
      aria-label="Tester l'item"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginTop: "1rem" }}
    >
      <h3 style={{ marginTop: 0 }}>Teste l&apos;item (sans clé, en local)</h3>
      <p style={{ color: "#555", marginTop: 0 }}>
        Réponds comme un apprenant le ferait, puis note la qualité de cet item. Rien
        n&apos;est envoyé tant que tu n&apos;as pas noté ; ton identité reste anonyme.
      </p>
      {scene.type === "quiz" && <QuizTake scene={scene} />}
      {scene.type === "spot_the_flaw" && (
        <FreeTextTake
          prompt={(scene as SpotTheFlawScene).flawed_content}
          grade={(a) => gradeSpotTheFlaw(scene as SpotTheFlawScene, a)}
          reference={(scene as SpotTheFlawScene).model_correction}
          referenceLabel="Cours corrigé (référence)"
          coverageLabel="Défauts attrapés"
        />
      )}
      {scene.type === "explain_back" && (
        <FreeTextTake
          prompt={(scene as ExplainBackScene).prompt}
          grade={(a) => gradeExplainBack(scene as ExplainBackScene, a)}
          reference={(scene as ExplainBackScene).model_explanation}
          referenceLabel="Explication de référence"
          coverageLabel="Idées-clés couvertes"
        />
      )}
    </section>
  );
}
