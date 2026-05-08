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
