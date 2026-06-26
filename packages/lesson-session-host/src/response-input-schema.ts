// packages/lesson-session-host/src/response-input-schema.ts  (shared zod for ResponseInput — DRY across drivers)
import { z } from "zod";

export const ResponseInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("quiz_choice"), choiceId: z.string() }),
  z.object({ kind: z.literal("confidence"), value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  z.object({ kind: z.literal("critique"), text: z.string() }),
  z.object({ kind: z.literal("flaw_report"), text: z.string() }),   // spot_the_flaw
  z.object({ kind: z.literal("explanation"), text: z.string() }),   // explain_back
  z.object({ kind: z.literal("comparison"), text: z.string() }),    // comparison
  z.object({ kind: z.literal("summary_audit"), text: z.string() }), // summary_audit
  z.object({ kind: z.literal("prompt_submission"), text: z.string() }), // prompt_practice
]);
