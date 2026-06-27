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

// D1 PeerStudio room bodies
export const OpenRoomBody = z.object({ bundle_ref: z.string().min(1) });
export const JoinRoomBody = z.object({
  join_code: z.string().min(1),
  session_id: z.string().min(1),
});
export const SubmitRatingBody = z.object({
  rater_session_id: z.string().min(1),
  target_session_id: z.string().min(1),
  passed: z.boolean(),
  rating: z.number().int().min(1).max(5),
  helpful: z.boolean(),
});
export const CloseRoomBody = z.object({ teacher_key: z.string().min(1) });
