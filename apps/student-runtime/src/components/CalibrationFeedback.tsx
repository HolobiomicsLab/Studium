import type { LearnerState } from "@studium/learner-state";
import { calibrationVerdict, type CalibrationBand } from "../lib/reviewQueue";

type Props = { conceptId: string; state: LearnerState; onClose: () => void };

const BAND_STYLE: Record<CalibrationBand, string> = {
  bien: "bg-green-50 border-green-300 text-green-900",
  sur: "bg-amber-50 border-amber-300 text-amber-900",
  sous: "bg-blue-50 border-blue-300 text-blue-900",
};
const BAND_TITLE: Record<CalibrationBand, string> = {
  bien: "Bien calibré·e",
  sur: "Plutôt surconfiant·e",
  sous: "Plutôt sous-confiant·e",
};

/** LEARNER-facing calibration feedback shown AFTER a meta_checkpoint. It tells the learner — in
 * words, never numbers — whether their declared confidence matched their actual performance
 * ("ta confiance était bien/sur/sous-calibrée"). It deliberately does NOT show the live numeric
 * mastery (that stays a teacher/model signal). Renders nothing if there is no checkpointed
 * calibration for this concept yet. */
export default function CalibrationFeedback({ conceptId, state, onClose }: Props) {
  const cs = state.concept_states[conceptId];
  if (!cs) return null;
  const verdict = calibrationVerdict(cs);
  if (!verdict) return null;
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Retour sur ta calibration"
        className={`rounded-lg border p-6 max-w-md w-full ${BAND_STYLE[verdict.band]}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-2">{BAND_TITLE[verdict.band]}</h3>
        <p className="text-sm mb-4">{verdict.message}</p>
        <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
