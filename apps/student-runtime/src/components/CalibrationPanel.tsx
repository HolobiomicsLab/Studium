import type { LearnerState } from "@studium/learner-state";

type Props = { conceptId: string; state: LearnerState; onClose: () => void };

export default function CalibrationPanel({ conceptId, state, onClose }: Props) {
  const cs = state.concept_states[conceptId];
  if (!cs) return null;
  const accuracyPct =
    cs.total_attempts > 0 ? Math.round((cs.total_correct / cs.total_attempts) * 100) : 0;
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-2">Calibration sur {conceptId}</h3>
        <p className="text-sm text-gray-600 mb-4">
          Compare ta confiance déclarée et ta réussite réelle sur ce concept.
        </p>
        <ul className="text-sm space-y-1">
          <li>Tentatives : {cs.total_attempts}</li>
          <li>
            Bonnes réponses : {cs.total_correct} ({accuracyPct}%)
          </li>
          <li>
            Calibration (écart confiance/réussite) :{" "}
            {cs.confidence_calibration.toFixed(2)}
          </li>
        </ul>
        <button
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
          onClick={onClose}
        >
          OK
        </button>
      </div>
    </div>
  );
}
