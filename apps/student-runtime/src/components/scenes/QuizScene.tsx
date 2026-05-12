import { useState, useEffect } from "react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";

type Props = {
  scene: Extract<Scene, { type: "quiz" }>;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
};

export default function QuizScene({ scene, onSignal, onContinue }: Props) {
  const [enteredAt] = useState(performance.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [correct, setCorrect] = useState(false);

  useEffect(() => {
    void onSignal({ kind: "scene_entered", scene_id: scene.id });
  }, []);

  const submit = async () => {
    const choice = scene.content.choices.find((c) => c.id === selected);
    const c = choice?.correct ?? false;
    setCorrect(c);
    setSubmitted(true);
    const concept_id = scene.concept_refs[0] ?? "default";
    await onSignal({
      kind: "answer_submitted",
      concept_id,
      scene_id: scene.id,
      correct: c,
      time_ms: performance.now() - enteredAt,
      hint_count: 0,
      difficulty: 0.5,
    });
  };

  return (
    <section className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-3">{scene.title}</h2>
      <p className="mb-4">{scene.content.question}</p>
      <ul className="space-y-2">
        {scene.content.choices.map((c) => (
          <li key={c.id}>
            <label
              className={`flex items-center gap-2 p-2 rounded cursor-pointer ${selected === c.id ? "bg-blue-50" : ""}`}
            >
              <input
                type="radio"
                name={scene.id}
                disabled={submitted}
                checked={selected === c.id}
                onChange={() => setSelected(c.id)}
              />
              <span>{c.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {!submitted && (
        <button
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded disabled:bg-gray-300"
          disabled={!selected}
          onClick={submit}
        >
          Soumettre
        </button>
      )}
      {submitted && (
        <div
          className={`mt-4 p-3 rounded ${correct ? "bg-green-50" : "bg-red-50"}`}
          aria-live="polite"
        >
          {correct ? scene.content.feedback_correct : scene.content.feedback_incorrect}
          <button
            className="ml-3 px-3 py-1 bg-blue-600 text-white rounded"
            onClick={onContinue}
          >
            Continuer
          </button>
        </div>
      )}
    </section>
  );
}
