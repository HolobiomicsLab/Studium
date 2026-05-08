import { useEffect, useState } from "react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";

type Props = {
  scene: Extract<Scene, { type: "reproduction" }>;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export default function ReproductionScene({ scene, onSignal, onContinue }: Props) {
  const [enteredAt] = useState(performance.now());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [failedSteps, setFailedSteps] = useState<string[]>([]);

  useEffect(() => {
    void onSignal({ kind: "scene_entered", scene_id: scene.id });
  }, []);

  const submit = async () => {
    const failures: string[] = [];
    for (const step of scene.steps) {
      const expected = normalize(step.expected_output);
      const actual = normalize(inputs[step.step_id]);
      if (actual !== expected) failures.push(step.step_id);
    }
    const success = failures.length === 0;
    setFailedSteps(failures);
    setSubmitted(true);
    const concept_id = scene.concept_refs[0] ?? "default";
    await onSignal({
      kind: "answer_submitted",
      concept_id,
      scene_id: scene.id,
      correct: success,
      time_ms: performance.now() - enteredAt,
      hint_count: 0,
      difficulty: 0.6,
    });
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
        Reproduction d&apos;une tâche de référence&nbsp;
        <code className="text-xs bg-gray-100 px-1 rounded">{scene.task_card_id}</code>
      </p>
      <ol className="space-y-3 list-decimal list-inside" data-testid="reproduction-steps">
        {scene.steps.map((step, i) => {
          const stepFailed = submitted && failedSteps.includes(step.step_id);
          return (
            <li key={step.step_id} className="space-y-1">
              <p className="text-sm font-medium">
                Étape {i + 1} : {step.instruction}
              </p>
              <input
                aria-label={`étape ${i + 1}`}
                className={`mt-1 w-full border rounded px-2 py-1 ${
                  stepFailed ? "border-red-400 bg-red-50" : ""
                }`}
                disabled={submitted}
                value={inputs[step.step_id] ?? ""}
                onChange={(e) =>
                  setInputs({ ...inputs, [step.step_id]: e.target.value })
                }
              />
              {stepFailed && (
                <p className="text-xs text-red-600">
                  Sortie attendue&nbsp;:{" "}
                  <code>{String(step.expected_output)}</code>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {!submitted && (
        <button
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
          onClick={submit}
          disabled={Object.keys(inputs).length === 0}
        >
          Valider
        </button>
      )}
      {submitted && (
        <div
          aria-live="polite"
          className={`mt-4 p-3 rounded ${
            failedSteps.length === 0 ? "bg-green-50" : "bg-amber-50"
          }`}
        >
          {failedSteps.length === 0 ? (
            <p>Toutes les étapes sont validées. Bien joué.</p>
          ) : (
            <p>
              {failedSteps.length} étape
              {failedSteps.length > 1 ? "s" : ""} à revoir.
            </p>
          )}
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
