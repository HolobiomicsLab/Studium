// apps/lesson-server/src/schemas.ts
import { z } from "zod";
import { ResponseInputSchema } from "@studium/lesson-session-host";
export { ResponseInputSchema } from "@studium/lesson-session-host";

export const CreateSessionBody = z.object({
  bundle_ref: z.string().min(1),
  learner_id: z.string().optional(),
  consent: z.record(z.unknown()).optional(),
});

export const RespondBody = z.object({ input: ResponseInputSchema });
export const TurnBody = z.object({ text: z.string().min(1) });
