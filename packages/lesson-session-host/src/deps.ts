// packages/lesson-session-host/src/deps.ts  (moved from server-deps.ts; renamed buildServerDeps → buildHostDeps)
import type { SessionDeps } from "@studium/lesson-session";
import {
  SystemClock, RandomIdGen, HmacPseudonymProvider,
  InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink,
  InMemoryMasteryClaimSink, FileMasteryClaimSink,
  LiteLLMReasoningScorer, StubReasoningScorer,
  HttpCritiqueEvaluator, StubCritiqueEvaluator,
} from "@studium/lesson-session/node";

/** #4 fail-closed: in live/production mode the pseudonym secret MUST be set and MUST NOT be the
 * "dev-secret" default — otherwise every deployment would share a guessable HMAC key, defeating
 * pseudonymisation. dev/test (live=false) keep the "dev-secret" default for convenience. */
function resolvePseudoSecret(live: boolean): string {
  const env = process.env["STUDIUM_PSEUDO_SECRET"];
  if (live && (!env || env === "dev-secret")) {
    throw new Error("STUDIUM_PSEUDO_SECRET must be set (and not 'dev-secret') in live mode");
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
