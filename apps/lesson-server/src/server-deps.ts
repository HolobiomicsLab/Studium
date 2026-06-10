// apps/lesson-server/src/server-deps.ts
import type { SessionDeps } from "@studium/lesson-session";
import {
  SystemClock, RandomIdGen, HmacPseudonymProvider,
  InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink,
  LiteLLMReasoningScorer, StubReasoningScorer,
  HttpCritiqueEvaluator, StubCritiqueEvaluator,
} from "@studium/lesson-session/node";

/** Each session gets its OWN in-memory stores (session isolation). */
export function buildServerDeps(live: boolean): SessionDeps {
  return {
    stateStore: new InMemoryStateStore(),
    eventLog: new InMemoryEventLog(),
    telemetry: new InMemoryTelemetrySink(),
    pseudonym: new HmacPseudonymProvider(process.env["STUDIUM_PSEUDO_SECRET"] ?? "dev-secret"),
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
  };
}
