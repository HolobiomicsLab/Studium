// apps/lesson-server/src/schemas.ts
import { z } from "zod";

export const CreateSessionBody = z.object({
  bundle_ref: z.string().min(1),
  learner_id: z.string().optional(),
  consent: z.record(z.unknown()).optional(),
});

export const ResponseInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("quiz_choice"), choiceId: z.string() }),
  z.object({ kind: z.literal("confidence"), value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) }),
  z.object({ kind: z.literal("critique"), text: z.string() }),
]);
export const RespondBody = z.object({ input: ResponseInputSchema });
export const TurnBody = z.object({ text: z.string().min(1) });
