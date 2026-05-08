// Placeholder — events defined in C.1
import { z } from "zod";

export const HealthCheckSchema = z.object({ ok: z.literal(true) });
