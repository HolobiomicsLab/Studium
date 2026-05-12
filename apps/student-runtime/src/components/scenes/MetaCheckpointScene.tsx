import { useState } from "react";
import type { Scene } from "@studium/lesson-bundle-schema";
import type { Signal } from "@studium/learner-state";

type Props = {
  scene: Extract<Scene, { type: "meta_checkpoint" }>;
  onSignal: (s: Signal) => Promise<unknown>;
  onContinue: () => void;
};

export default function MetaCheckpointScene({ scene, onSignal, onContinue }: Props) {
  const [value, setValue] = useState<number>(2);

  const submit = async () => {
    await onSignal({
      kind: "confidence_declared",
      scene_id: scene.id,
      value: value as 0 | 1 | 2 | 3 | 4,
    });
    onContinue();
  };

  return (
    <section className="max-w-2xl mx-auto bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-2">{scene.title}</h2>
      <p className="mb-4">{scene.pre_question}</p>
      <div className="flex justify-between mb-2">
        {scene.scale_labels.map((_label, i) => (
          <button
            key={i}
            onClick={() => setValue(i)}
            className={`px-3 py-2 rounded text-sm ${value === i ? "bg-blue-600 text-white" : "bg-gray-200"}`}
          >
            {i}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-6">{scene.scale_labels[value]}</p>
      <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={submit}>
        Continuer
      </button>
    </section>
  );
}
