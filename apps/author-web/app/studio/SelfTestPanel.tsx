"use client";
import { useState } from "react";
import { gradeQuizChoice, type QuizScene } from "@/lib/quiz-scene";

// KEY-FREE self-test. The learner answers their OWN drafted quiz and sees the
// REAL feedback_correct / feedback_incorrect, graded locally by the pure
// gradeQuizChoice (no API key, no LLM, no Node-only SessionHost). This is a
// pre-submit, on-device preview — nothing here is routed to the backend.
export function SelfTestPanel({ scene }: { scene: QuizScene }) {
  const [picked, setPicked] = useState<string | null>(null);

  const result = picked ? gradeQuizChoice(scene, picked) : null;

  return (
    <section
      aria-label="Auto-test"
      style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.75rem", marginTop: "1rem" }}
    >
      <h3 style={{ marginTop: 0 }}>Auto-test (sans clé, en local)</h3>
      <p style={{ color: "#555", marginTop: 0 }}>
        Réponds à ton propre quiz pour vérifier le feedback que verront tes pairs.
      </p>
      <p style={{ fontWeight: 600 }}>{scene.question}</p>
      <div role="radiogroup" aria-label="choix" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {scene.choices.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="radio"
              name="selftest-choice"
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
          data-testid="selftest-feedback"
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
    </section>
  );
}
