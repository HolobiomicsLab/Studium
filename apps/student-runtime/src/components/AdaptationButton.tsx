import { useState } from "react";
import type { Decision } from "@studium/learner-state";

/**
 * Named export — QW2 M6 explicabilité.
 *
 * Renders an inline "?" button labelled with the rule_id and exposes the
 * human-readable label via `title` (HTML tooltip) and `aria-label` (a11y).
 * Includes focus-visible ring (QW1 WCAG 2.1 AA).
 */
type AdaptationButtonProps = {
  ruleId: string;
  ruleLabel?: string;
};

export function AdaptationButton({ ruleId, ruleLabel }: AdaptationButtonProps) {
  const label = ruleLabel ?? ruleId;
  return (
    <button
      type="button"
      aria-label={`Pourquoi cette adaptation : ${label}`}
      title={label}
      className="inline-flex items-center gap-1 px-2 py-1 rounded border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
    >
      <span aria-hidden="true">?</span>
      <span className="text-xs text-gray-500">{ruleId}</span>
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * Default export — legacy floating overlay driven by an adaptation Decision.
 * Preserves the previous behaviour for LessonPlayer.
 */
export default function AdaptationButtonOverlay({
  decision,
}: {
  decision: Decision | null;
}) {
  const [open, setOpen] = useState(false);
  if (!decision || !decision.rule_id) return null;
  return (
    <>
      <button
        aria-label="Pourquoi cette adaptation ?"
        title={decision.explanation_short ?? undefined}
        className="fixed bottom-4 right-4 w-10 h-10 rounded-full bg-blue-600 text-white shadow-lg z-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2"
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
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2"
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
