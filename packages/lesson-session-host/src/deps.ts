// packages/lesson-session-host/src/deps.ts  (moved from server-deps.ts; renamed buildServerDeps → buildHostDeps)
import { join } from "node:path";
import type { SessionDeps } from "@studium/lesson-session";
import {
  SystemClock, RandomIdGen, HmacPseudonymProvider,
  InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink,
  InMemoryMasteryClaimSink, FileMasteryClaimSink, FileStateStore, JsonlEventLog,
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

/** Sanitize a bundle_id as a single path segment — bundle_ids may contain ':' or '/'. The
 * pseudonym is already a 16-hex string (HmacPseudonymProvider) so it is inherently path-safe. */
function sanitizeSegment(s: string): string { return s.replace(/[^A-Za-z0-9_.-]/g, "_"); }

/** #3 durable scope: the per-(pseudonym, bundle_id) leaf directory under STUDIUM_DATA_DIR. The
 * pseudonym (NOT the raw learnerId — RGPD) is the on-disk key, so the same learner+lesson always
 * resolves to the same dir (longitudinal continuity) and distinct learners stay isolated. */
export function durableScopeDir(dataDir: string, pseudonym: string, bundleId: string): string {
  return join(dataDir, sanitizeSegment(pseudonym), sanitizeSegment(bundleId));
}

/** #3 durable mode is gated by STUDIUM_DATA_DIR (mirrors the STUDIUM_MASTERY_DIR convention).
 * Returns the configured data dir, or null when unset/empty (in-memory default for tests/ephemeral). */
export function durableDataDir(): string | null {
  const d = process.env["STUDIUM_DATA_DIR"];
  return d ? d : null;
}

/** Each session gets its OWN stores (session isolation).
 *
 * #3 durable mode: when `scopeDir` is provided (the host derives it from the pseudonym + bundle_id,
 * see host.create), the three InMemory stores are swapped for File* adapters all rooted at that
 * single per-learner directory, so:
 *   - state-<bundle_id>.json   (FileStateStore)
 *   - events.jsonl             (JsonlEventLog)
 *   - mastery/*.jsonld         (FileMasteryClaimSink — co-located, OVERRIDES STUDIUM_MASTERY_DIR)
 * When `scopeDir` is omitted the behavior is byte-for-byte the previous in-memory default (the gate
 * is opt-in; the 18 host tests + server/mcp baselines stay green). pseudonym/clock/idGen/scorers
 * are identical in both modes — crucially the SAME HmacPseudonymProvider instance the host uses to
 * derive `scopeDir`, so the host dir pseudonym === session pseudonym (no salt drift). */
export function buildHostDeps(live: boolean, scopeDir?: string): SessionDeps {
  const pseudonym = new HmacPseudonymProvider(resolvePseudoSecret(live));
  const durable = scopeDir !== undefined;
  return {
    stateStore: durable ? new FileStateStore(scopeDir) : new InMemoryStateStore(),
    eventLog: durable ? new JsonlEventLog(join(scopeDir, "events.jsonl")) : new InMemoryEventLog(),
    telemetry: new InMemoryTelemetrySink(),
    pseudonym,
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
    // In durable mode mastery is co-located under the per-learner dir (overrides STUDIUM_MASTERY_DIR).
    masteryClaimSink: durable
      ? new FileMasteryClaimSink(join(scopeDir, "mastery"))
      : process.env["STUDIUM_MASTERY_DIR"]
        ? new FileMasteryClaimSink(process.env["STUDIUM_MASTERY_DIR"])
        : new InMemoryMasteryClaimSink(),
  };
}
