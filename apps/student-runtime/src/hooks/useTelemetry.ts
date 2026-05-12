import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TelemetryEvent } from "@studium/telemetry-events";

export type TelemetryContext = {
  learner_pseudonym: string;
  lesson_id: string;
  bundle_version: string;
};

type Options = {
  endpoint: string | null;
  courseToken: string;
  context: TelemetryContext;
  batchSize?: number;
  flushIntervalMs?: number;
};

type EmitInput = Omit<
  TelemetryEvent,
  "event_id" | "learner_pseudonym" | "lesson_id" | "bundle_version" | "client_timestamp"
>;

export type TelemetryEmit = (partial: EmitInput) => void;

/**
 * Résout l'endpoint télémétrie effectif.
 *
 * Mode test E2E (C.8) : si `window.__telemetry_endpoint` est défini par le
 * spec WDIO avant le démarrage du parcours, il prime sur l'endpoint fourni
 * par l'app (fallback). Cela permet au runtime release de pointer vers un
 * collector local (http://localhost:8003/telemetry) sans rebuild.
 *
 * Mode normal : retourne `fallback` (peut être `null` si l'apprenant n'a pas
 * consenti niveau B — voir ConsentScreen).
 */
export function getTelemetryEndpoint(fallback: string | null): string | null {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __telemetry_endpoint?: string };
    if (typeof w.__telemetry_endpoint === "string" && w.__telemetry_endpoint.length > 0) {
      return w.__telemetry_endpoint;
    }
  }
  return fallback;
}

/**
 * Résout le X-Course-Token effectif. Même logique d'override test que
 * `getTelemetryEndpoint`, via `window.__course_token`.
 */
export function getTelemetryCourseToken(fallback: string): string {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __course_token?: string };
    if (typeof w.__course_token === "string" && w.__course_token.length > 0) {
      return w.__course_token;
    }
  }
  return fallback;
}

export function useTelemetry(opts: Options) {
  const buffer = useRef<TelemetryEvent[]>([]);
  const batchSize = opts.batchSize ?? 20;
  const flushInterval = opts.flushIntervalMs ?? 30_000;
  const ctxRef = useRef(opts.context);
  ctxRef.current = opts.context;

  const sendBatch = useCallback(
    async (events: TelemetryEvent[]) => {
      if (!opts.endpoint || events.length === 0) return;
      try {
        const r = await fetch(opts.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Course-Token": opts.courseToken,
          },
          body: JSON.stringify({ events }),
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
      } catch {
        for (const ev of events) {
          await invoke("telemetry_outbox_push", { eventJson: JSON.stringify(ev) });
        }
      }
    },
    [opts.endpoint, opts.courseToken],
  );

  const flush = useCallback(async () => {
    const events = buffer.current.splice(0, buffer.current.length);
    await sendBatch(events);
  }, [sendBatch]);

  const emit = useCallback(
    (partial: EmitInput) => {
      const event = enrichEvent(partial, ctxRef.current);
      buffer.current.push(event);
      if (buffer.current.length >= batchSize) {
        void flush();
      }
    },
    [batchSize, flush],
  );

  // Drain outbox + send pending events on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const drained = (await invoke<string[]>("telemetry_outbox_drain")) ?? [];
        if (cancelled || drained.length === 0) return;
        const events = drained
          .map((s) => {
            try {
              return JSON.parse(s) as TelemetryEvent;
            } catch {
              return null;
            }
          })
          .filter((e): e is TelemetryEvent => e !== null);
        if (events.length > 0) await sendBatch(events);
      } catch {
        /* swallow — best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sendBatch]);

  // Periodic flush
  useEffect(() => {
    const id = setInterval(() => void flush(), flushInterval);
    return () => clearInterval(id);
  }, [flush, flushInterval]);

  return { emit, flush };
}

function enrichEvent(partial: EmitInput, ctx: TelemetryContext): TelemetryEvent {
  return {
    event_id: crypto.randomUUID(),
    learner_pseudonym: ctx.learner_pseudonym,
    lesson_id: ctx.lesson_id,
    bundle_version: ctx.bundle_version,
    client_timestamp: new Date().toISOString(),
    ...partial,
  } as TelemetryEvent;
}
