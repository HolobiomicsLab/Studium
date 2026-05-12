import { useEffect, useState } from "react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";
import type { TelemetryEmit } from "../../hooks/useTelemetry";

type Props = {
  scene: Extract<Scene, { type: "ai_critique" }>;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
  endpoint?: string;
  emit?: TelemetryEmit;
};

type EvalResponse = { score: number; feedback: string };

export default function AICritiqueScene({ scene, onSignal, onContinue, endpoint, emit }: Props) {
  const [enteredAt] = useState(performance.now());
  const [critique, setCritique] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EvalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void onSignal({ kind: "scene_entered", scene_id: scene.id });
  }, []);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const url = endpoint ?? "http://localhost:8002/scenes/critique-eval";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claims: scene.claims,
          rubric: scene.rubric,
          student_critique: critique,
        }),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = (await r.json()) as EvalResponse;
      setResult(data);
      const concept_id = scene.concept_refs[0] ?? "default";
      const passed = data.score >= 0.6;
      const trimmed = critique.trim();
      const claimsCount = scene.claims.length;
      // crude completion ratio: count of claim id mentions / total claims
      const mentioned = scene.claims.reduce(
        (n, c) => n + (trimmed.toLowerCase().includes(c.id.toLowerCase()) ? 1 : 0),
        0,
      );
      const completion_rate = claimsCount === 0
        ? 0
        : Math.max(0, Math.min(1, mentioned / claimsCount));
      emit?.({
        type: "critique_submitted",
        scene_id: scene.id,
        llm_score: Math.max(0, Math.min(1, data.score)),
        completion_rate,
      });
      await onSignal({
        kind: "answer_submitted",
        concept_id,
        scene_id: scene.id,
        correct: passed,
        time_ms: performance.now() - enteredAt,
        hint_count: 0,
        difficulty: 0.7,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="max-w-3xl mx-auto bg-white shadow rounded-lg p-6"
      aria-labelledby={`scene-${scene.id}-title`}
    >
      <h2 id={`scene-${scene.id}-title`} className="text-lg font-semibold mb-2">
        {scene.title}
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Lisez les affirmations ci-dessous et identifiez ce qui ne va pas dans
        chacune. Soyez précis·e.
      </p>
      <ul className="space-y-3 mb-4" data-testid="critique-claims">
        {scene.claims.map((claim) => (
          <li
            key={claim.id}
            className="border rounded p-3 bg-gray-50"
            data-testid={`claim-${claim.id}`}
          >
            <p className="text-sm font-mono text-gray-500">{claim.id}</p>
            <p className="mt-1">{claim.text}</p>
          </li>
        ))}
      </ul>
      <label className="block">
        <span className="block text-sm font-medium mb-1">Votre critique</span>
        <textarea
          aria-label="critique-textarea"
          rows={6}
          className="w-full border rounded p-2"
          value={critique}
          onChange={(e) => setCritique(e.target.value)}
          disabled={submitting || result !== null}
          placeholder="Listez les biais, erreurs factuelles ou imprécisions repérés."
        />
      </label>
      {!result && (
        <button
          className="mt-3 px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
          disabled={critique.trim().length < 10 || submitting}
          onClick={submit}
        >
          {submitting ? "Évaluation…" : "Soumettre la critique"}
        </button>
      )}
      {error && (
        <p className="mt-3 text-red-600" role="alert">
          Erreur d&apos;évaluation : {error}
        </p>
      )}
      {result && (
        <div
          aria-live="polite"
          className={`mt-4 p-3 rounded ${
            result.score >= 0.6 ? "bg-green-50" : "bg-amber-50"
          }`}
          data-testid="critique-result"
        >
          <p className="text-sm">
            <strong>Score</strong>&nbsp;: {Math.round(result.score * 100)}%
          </p>
          <p className="mt-1 text-sm">{result.feedback}</p>
          <button
            className="mt-2 px-3 py-1 bg-blue-600 text-white rounded"
            onClick={onContinue}
          >
            Continuer
          </button>
        </div>
      )}
    </section>
  );
}
