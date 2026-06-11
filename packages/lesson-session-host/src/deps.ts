// packages/lesson-session-host/src/deps.ts  (moved from server-deps.ts; renamed buildServerDeps → buildHostDeps)
import type { SessionDeps } from "@studium/lesson-session";
import {
  SystemClock, RandomIdGen, HmacPseudonymProvider,
  InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink,
  InMemoryMasteryClaimSink, FileMasteryClaimSink,
  LiteLLMReasoningScorer, StubReasoningScorer,
  HttpCritiqueEvaluator, StubCritiqueEvaluator,
} from "@studium/lesson-session/node";

/** #4 fail-closed: refuse a missing/empty/"dev-secret" secret whenever ANY production-ish signal
 * is present — i.e. when `live === true` (LiteLLM wired) OR `NODE_ENV === "production"` OR
 * `STUDIUM_ENV === "production"`. This prevents a real production deployment that doesn't use
 * LiteLLM from silently falling back to the shared guessable HMAC key.
 * dev/test: permissive — default to "dev-secret" only when none of those signals are set. */
function resolvePseudoSecret(live: boolean): string {
  const env = process.env["STUDIUM_PSEUDO_SECRET"];
  const isProd = live
    || process.env["NODE_ENV"] === "production"
    || process.env["STUDIUM_ENV"] === "production";
  if (isProd && (!env || env === "dev-secret")) {
    throw new Error(
      "STUDIUM_PSEUDO_SECRET must be set (and not 'dev-secret') in production mode " +
      "(live=true, NODE_ENV=production, or STUDIUM_ENV=production)",
    );
  }
  return env ?? "dev-secret";
}

/** Each session gets its OWN in-memory stores (session isolation). */
export function buildHostDeps(live: boolean): SessionDeps {
  return {
    stateStore: new InMemoryStateStore(),
    eventLog: new InMemoryEventLog(),
    telemetry: new InMemoryTelemetrySink(),
    pseudonym: new HmacPseudonymProvider(resolvePseudoSecret(live)),
    clock: new SystemClock(),
    idGen: new RandomIdGen(),
    reasoningScorer: live
      ? new LiteLLMReasoningScorer({
          mode: "litellm",
          baseUrl: process.env["LITELLM_BASE_URL"] ?? "",
          ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}),
        })
      : new StubReasoningScorer(),
    critiqueEvaluator: live ? new HttpCritiqueEvaluator() : new StubCritiqueEvaluator(),
    masteryClaimSink: process.env["STUDIUM_MASTERY_DIR"]
      ? new FileMasteryClaimSink(process.env["STUDIUM_MASTERY_DIR"])
      : new InMemoryMasteryClaimSink(),
  };
}
