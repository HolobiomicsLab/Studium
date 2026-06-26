import type { LearnerState } from "@studium/learner-state";
import { dueConcepts } from "../lib/reviewQueue";

type Props = { state: LearnerState; nowMs?: number };

/** A small "À réviser / Due for review" indicator. Surfaces the FSRS review schedule the engine
 * already computes (packages/adaptation-engine/src/fsrs.ts): the concepts whose retrievability has
 * decayed past the request-retention threshold and are due for a reinforcement pass. Renders nothing
 * when nothing is due. NOTE: this is a recall-timing cue, NOT a mastery score — no numeric mastery
 * is shown to the learner. */
export default function ReviewDueIndicator({ state, nowMs }: Props) {
  const due = dueConcepts(state, nowMs);
  if (due.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Concepts à réviser"
      className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-900 px-3 py-1 text-sm"
    >
      <span aria-hidden="true">🔁</span>
      <span>
        À réviser : {due.length} concept{due.length > 1 ? "s" : ""}
      </span>
      <span className="sr-only">
        {due.map((d) => d.concept_id).join(", ")}
      </span>
    </div>
  );
}
