// packages/lesson-session-host/src/response-input-schema.ts  (shared zod for ResponseInput — DRY across drivers)
import { z } from "zod";

// optional per-answer self-rated confidence (0..4) — capture-ready path to CONTINUOUS calibration (no
// UI supplies it yet; the live calibration input today is the meta-checkpoint). Any graded answer MAY
// carry it, and the engine then folds it into the concept's confidence_calibration that turn.
const conf = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional();

export const ResponseInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("quiz_choice"), choiceId: z.string(), confidence: conf }),
  z.object({ kind: z.literal("confidence"), value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  z.object({ kind: z.literal("critique"), text: z.string(), confidence: conf }),
  z.object({ kind: z.literal("flaw_report"), text: z.string(), confidence: conf }),   // spot_the_flaw
  z.object({ kind: z.literal("explanation"), text: z.string(), confidence: conf }),   // explain_back
  z.object({ kind: z.literal("comparison"), text: z.string(), confidence: conf }),    // comparison
  z.object({ kind: z.literal("summary_audit"), text: z.string(), confidence: conf }), // summary_audit
  z.object({ kind: z.literal("prompt_submission"), text: z.string(), confidence: conf }), // prompt_practice
  z.object({ kind: z.literal("communication"), text: z.string(), confidence: conf }),     // communication_sim
]);
