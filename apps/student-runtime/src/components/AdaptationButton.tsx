import { useState } from "react";
import type { Decision } from "@studium/learner-state";

export default function AdaptationButton({ decision }: { decision: Decision | null }) {
  const [open, setOpen] = useState(false);
  if (!decision || !decision.rule_id) return null;
  return (
    <>
      <button
        aria-label="Pourquoi cette adaptation ?"
        className="fixed bottom-4 right-4 w-10 h-10 rounded-full bg-blue-600 text-white shadow-lg z-40"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-live="polite"
          >
            <h3 className="text-lg font-bold mb-1">
              Adaptation [{decision.modulator}] · {decision.rule_id}
            </h3>
            <p className="text-gray-700 my-3">{decision.explanation_short}</p>
            <p className="text-xs text-gray-500">
              Tu peux désactiver ces adaptations dans Réglages.
            </p>
            <button
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
              onClick={() => setOpen(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
