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

// Distributive Omit preserves the discriminated union (Omit<U, K> collapses it).
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type EmitInput = DistributiveOmit<
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
 * L'endpoint effectif POUR UN APPRENANT DONNÉ, consentement compris.
 *
 * `getTelemetryEndpoint` ci-dessus résout une CONFIGURATION ; il ne sait rien de ce que
 * l'apprenant a accepté, et son propre commentaire promettait déjà le contraire (« peut être
 * `null` si l'apprenant n'a pas consenti niveau B »). Aucun appelant ne lisait le
 * consentement : l'écran le stockait, et la transmission partait quand même dès qu'un
 * endpoint était configuré. Cette fonction est le portillon manquant.
 *
 * Elle échoue FERMÉE, et c'est le point : pas d'enregistrement, lecture impossible, ou
 * enregistrement sans le niveau B → `null`, donc rien ne part. Une transmission est un accord
 * donné, pas un défaut dont on se retire, et l'override de test `window.__telemetry_endpoint`
 * ne le contourne pas — sinon le portillon ne tiendrait précisément pas dans le seul mode où
 * l'application transmet réellement.
 *
 * Le niveau retenu est B parce que c'est celui que l'écran de consentement montre à
 * l'apprenant sous « Indicateurs … pour l'enseignant … transmis » : c'est la case qu'il a
 * cochée. `docs/user/student-guide.md` numérote autrement (C) — la contradiction entre les
 * deux surfaces appartient au propriétaire du produit, pas à ce portillon.
 */
export function resolveTelemetryEndpoint(
  consent: { level_b?: boolean } | null | undefined,
  fallback: string | null,
): string | null {
  if (!consent?.level_b) return null;
  return getTelemetryEndpoint(fallback);
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
        for (let index = 0; index < events.length; index += 1) {
          try {
            await invoke("telemetry_outbox_push", { eventJson: JSON.stringify(events[index]) });
          } catch (error) {
            // Keep only the suffix not durably queued.
            buffer.current.unshift(...events.slice(index));
            throw error;
          }
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
        void flush().catch(() => { /* Buffered suffix retries later. */ });
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
    const id = setInterval(() => void flush().catch(() => { /* Buffered suffix retries later. */ }), flushInterval);
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
