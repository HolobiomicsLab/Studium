// packages/lesson-session-host/src/deps.ts  (moved from server-deps.ts; renamed buildServerDeps → buildHostDeps)
import { join } from "node:path";
import type { Clock, SessionDeps } from "@studium/lesson-session";
import {
  SystemClock, RandomIdGen, HmacPseudonymProvider,
  InMemoryStateStore, InMemoryEventLog, InMemoryTelemetrySink,
  InMemoryMasteryClaimSink, FileMasteryClaimSink, FileStateStore, JsonlEventLog,
  JsonlTelemetrySink,
  LiteLLMReasoningScorer, StubReasoningScorer,
  LiteLLMSocraticTutor, StubSocraticTutor,
  HttpCritiqueEvaluator, StubCritiqueEvaluator,
  HttpLlmAuditJudge,
} from "@studium/lesson-session/node";

/** STUDIUM_PSEUDO_SECRET, or undefined when it is unset or blank (L-11: SEC-7, CC-7, CQ-2). A variable a
 * harness exported empty (`STUDIUM_PSEUDO_SECRET=`, or the .env.example line uncommented) is unset, as
 * persistence.ts treats every setting: a durable host then keys its learners with the data folder's own
 * secret, never with an empty HMAC key anyone can recompute. A secret that is set is used as written. */
export function envPseudoSecret(): string | undefined {
  const value = process.env["STUDIUM_PSEUDO_SECRET"];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** #4 fail-closed: refuse a missing/empty/"dev-secret" secret whenever ANY production-ish signal
 * is present — i.e. when `live === true` (LiteLLM wired) OR `NODE_ENV === "production"` OR
 * `STUDIUM_ENV === "production"`. This prevents a real production deployment that doesn't use
 * LiteLLM from silently falling back to the shared guessable HMAC key.
 * dev/test: permissive — default to "dev-secret" only when none of those signals are set.
 *
 * I-6: STUDIUM_PSEUDO_SECRET wins; without it a durable host passes its data folder's own secret
 * (`installSecret`, pseudonym-secret.ts), which is random per install and so passes the production
 * check — unless it is the legacy "dev-secret" a folder written before I-6 keeps. */
function resolvePseudoSecret(live: boolean, installSecret?: string): string {
  const env = envPseudoSecret();
  const secret = env !== undefined ? env : installSecret;
  const isProd = live
    || process.env["NODE_ENV"] === "production"
    || process.env["STUDIUM_ENV"] === "production";
  if (isProd && (!secret || secret === "dev-secret")) {
    throw new Error(
      "STUDIUM_PSEUDO_SECRET must be set (and not 'dev-secret') in production mode " +
      "(live=true, NODE_ENV=production, or STUDIUM_ENV=production)",
    );
  }
  return secret ?? "dev-secret";
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

/** Teacher analytics consent gate (ADR-006). Telemetry is collected to a durable, aggregatable
 * sink ONLY when the learner/teacher has explicitly opted in via STUDIUM_TELEMETRY_CONSENT
 * (truthy: "1"/"true"/"granted"/"yes"). Default = OFF: the in-memory sink is used and NOTHING is
 * persisted. Even when granted, only the pseudonymized refs/scalars ADR-006 already permits are
 * written (no free text; mastery stays in the local state store, never in telemetry). The sink is
 * written under the per-learner pseudonymized scope dir, so it requires durable mode (a scopeDir)
 * to have somewhere to land — without STUDIUM_DATA_DIR the consent flag is inert. */
export function telemetryConsentGranted(): boolean {
  const v = (process.env["STUDIUM_TELEMETRY_CONSENT"] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "granted" || v === "yes";
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
 * derive `scopeDir`, so the host dir pseudonym === session pseudonym (no salt drift).
 * `installSecret` is the durable data folder's own pseudonym secret (I-6), used when
 * STUDIUM_PSEUDO_SECRET is unset. */
export function buildHostDeps(live: boolean, scopeDir?: string, clock?: Clock, installSecret?: string): SessionDeps {
  const pseudonym = new HmacPseudonymProvider(resolvePseudoSecret(live, installSecret));
  const durable = scopeDir !== undefined;
  // Consented telemetry: durable mode + explicit opt-in → write the pseudonymized ADR-006 event
  // stream to telemetry.jsonl under the per-learner scope dir (a teacher's class_report aggregates
  // it). Otherwise the in-memory sink (nothing persisted) — the privacy-preserving default.
  // A new stream opens with `consent_granted` scope B (ADR 006: pedagogical telemetry for the
  // teacher), the proof tools/interaction_report.py requires. What it asserts is what is true here:
  // the operator declared consent through STUDIUM_TELEMETRY_CONSENT; no learner clicked anything.
  const telemetry = durable && telemetryConsentGranted()
    ? new JsonlTelemetrySink(join(scopeDir, "telemetry.jsonl"), { consentScope: "B" })
    : new InMemoryTelemetrySink();
  return {
    stateStore: durable ? new FileStateStore(scopeDir) : new InMemoryStateStore(),
    eventLog: durable ? new JsonlEventLog(join(scopeDir, "events.jsonl")) : new InMemoryEventLog(),
    telemetry,
    pseudonym,
    clock: clock ?? new SystemClock(),
    idGen: new RandomIdGen(),
    reasoningScorer: live
      ? new LiteLLMReasoningScorer({
          mode: "litellm",
          baseUrl: process.env["LITELLM_BASE_URL"] ?? "",
          ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}),
        }, Number(process.env["STUDIUM_LLM_TIMEOUT_MS"] ?? 20000))
      : new StubReasoningScorer(),
    critiqueEvaluator: live ? new HttpCritiqueEvaluator() : new StubCritiqueEvaluator(),
    // OVER-DISTRUST: only LIVE (LITELLM_BASE_URL) wires an LLM audit judge — an offline run leaves it
    // undefined, so the keyword matcher grades audits and over-distrust stays 0 (the honesty boundary).
    // A grounded spot_the_flaw with sound_claims + this judge produces a real false_positive signal.
    ...(live && process.env["LITELLM_BASE_URL"]
      ? { auditJudge: new HttpLlmAuditJudge(process.env["LITELLM_BASE_URL"], {
          ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}),
          ...(process.env["LITELLM_MODEL"] !== undefined ? { model: process.env["LITELLM_MODEL"] } : {}),
        }) }
      : {}),
    // EV-3a: Socratic tutor for discussion scenes. Offline (live=false) wires the
    // deterministic, never-revealing StubSocraticTutor so the narrative free-text dialogue
    // works without an LLM; live mode swaps in the LiteLLM tutor (same opts as the scorer).
    socraticTutor: live
      ? new LiteLLMSocraticTutor({
          mode: "litellm",
          baseUrl: process.env["LITELLM_BASE_URL"] ?? "",
          ...(process.env["LITELLM_API_KEY"] !== undefined ? { apiKey: process.env["LITELLM_API_KEY"] } : {}),
        }, Number(process.env["STUDIUM_LLM_TIMEOUT_MS"] ?? 20000))
      : new StubSocraticTutor(),
    // In durable mode mastery is co-located under the per-learner dir (overrides STUDIUM_MASTERY_DIR).
    masteryClaimSink: durable
      ? new FileMasteryClaimSink(join(scopeDir, "mastery"))
      : process.env["STUDIUM_MASTERY_DIR"]
        ? new FileMasteryClaimSink(process.env["STUDIUM_MASTERY_DIR"])
        : new InMemoryMasteryClaimSink(),
  };
}
