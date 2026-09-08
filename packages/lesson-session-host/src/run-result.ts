// run-result.ts — the `run_result.json` contract: what a PLUGGABLE AGENTIC OPERATOR writes back after it
// provisions the env, installs deps, and RUNS the capsule in the workspace (Studium never executes — pure
// delegation). Studium ingests this as the learner's OWN executed result and gates "you actually ran it"
// on `ran && passed`. Lenient by design: extra keys are ignored; a partial/invalid write parses to null
// (treated as "not ready, retry") so a half-written file never wedges the channel.
import { z } from "zod";
import type { ReferenceRun, RunManifest } from "@studium/lesson-bundle-schema";

export const RunResultSchema = z.object({
  ran: z.boolean(),
  passed: z.boolean(),
  landmark: z.string().nullable().optional(),
  artifacts: z.array(z.string()).default([]), // produced file paths
  checks: z.array(z.object({ check: z.string(), passed: z.boolean() })).default([]),
  stdout_tail: z.string().optional(),
  provenance: z.object({ cmd: z.array(z.string()).optional(), env: z.string().optional() }).optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

/** Parse + validate a run_result.json string. Returns null on absent/partial/invalid (retry), never throws. */
export function parseRunResult(raw: string): RunResult | null {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  const r = RunResultSchema.safeParse(data);
  return r.success ? r.data : null;
}

const _FIGURE_RE = /\.(png|svg|jpe?g|pdf)$/i;

export interface RunAttestation {
  /** True when the returned run is internally consistent with its manifest (no theatre detected). */
  trusted: boolean;
  /** Human-readable reasons a run was NOT trusted (empty when trusted). */
  reasons: string[];
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** Attest a learner-produced run against its manifest WITHOUT executing (Studium is brain-only): every
 * check runs purely on what the operator already returned, so no execution is added. Catches "operation-
 * as-theatre" — a run that claims success without producing the declared outputs, skips or fails a declared
 * check, asserts passed while a returned check failed, or returns no landmark. NON-answer-bearing: the
 * landmark VALUE is never inspected (it is withheld by design), only structural integrity. An untrusted run
 * is QUARANTINED by the ingest core — it may still advance the lesson (the pure-delegation "you ran it"
 * gate is unchanged) but it never grounds a judgment, so a fabricated run cannot feed trust_calibration.
 * BOUNDARY (honest): this raises the bar against LAZY / PARTIAL / INCONSISTENT theatre; it cannot catch a
 * PERFECT forgery that fabricates both artifacts and checks — Studium has no cryptographic execution
 * attestation (brain-only). A well-behaved operator that follows the run_manifest template attests cleanly. */
export function verifyRunAttestation(manifest: RunManifest, result: RunResult): RunAttestation {
  const reasons: string[] = [];
  const produced = new Set(result.artifacts.map(basename));
  for (const out of manifest.expected_outputs) {
    if (!produced.has(basename(out))) reasons.push(`declared output not produced: ${out}`);
  }
  const reported = new Map(result.checks.map((c) => [c.check, c.passed]));
  for (const chk of manifest.verify_checks) {
    if (!reported.has(chk)) reasons.push(`declared check not reported: ${chk}`);
    else if (!reported.get(chk)) reasons.push(`declared check failed: ${chk}`);
  }
  if (result.passed && result.checks.some((c) => !c.passed)) {
    reasons.push("reported passed=true but a returned check failed");
  }
  const expectsWork = manifest.expected_outputs.length > 0 || manifest.verify_checks.length > 0;
  if (expectsWork && !(result.landmark ?? "").trim()) {
    reasons.push("no landmark returned for a run that declares outputs/checks");
  }
  return { trusted: reasons.length === 0, reasons };
}

/** Project an operator run_result into a ReferenceRun (the carrier a spot_the_flaw scene grounds on),
 * so a later judgment scene can be grounded on the learner's OWN run. The figure is the first image-like
 * artifact; provenance marks it as the learner's workspace run (no capsule DOI). */
export function runResultToReferenceRun(r: RunResult): ReferenceRun {
  return {
    ran: r.ran,
    passed: r.passed,
    landmark: r.landmark ?? null,
    // first image-like artifact in declared order (illustrative, not graded — order-dependent by design).
    figure_path: r.artifacts.find((a) => _FIGURE_RE.test(a)) ?? null,
    checks: r.checks,
    provenance: { capsule_doi: null, cmd: r.provenance?.cmd ?? [], env: r.provenance?.env ?? "learner workspace" },
  };
}
