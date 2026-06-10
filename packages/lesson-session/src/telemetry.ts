// packages/lesson-session/src/telemetry.ts
import type { TelemetryEvent } from "@studium/telemetry-events";
import type { Clock, IdGen } from "./ports.js";

export interface TelemetryContext {
  learnerPseudonym: string;
  lessonId: string;
  bundleVersion: string;
}

type EnrichedKeys = "event_id" | "learner_pseudonym" | "lesson_id" | "bundle_version" | "client_timestamp";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type EmitInput = DistributiveOmit<TelemetryEvent, EnrichedKeys>;

export function enrichEvent(partial: EmitInput, ctx: TelemetryContext, clock: Clock, idGen: IdGen): TelemetryEvent {
  return {
    event_id: idGen.uuid(),
    learner_pseudonym: ctx.learnerPseudonym,
    lesson_id: ctx.lessonId,
    bundle_version: ctx.bundleVersion,
    client_timestamp: clock.now(),
    ...partial,
  } as TelemetryEvent;
}

export function bundleVersionOf(bundle: { schema_version: string; bundle_id: string; validated_at: string }): string {
  return `${bundle.schema_version}:${bundle.bundle_id}@${bundle.validated_at}`;
}
