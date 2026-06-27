// run-result.ts — the `run_result.json` contract: what a PLUGGABLE AGENTIC OPERATOR writes back after it
// provisions the env, installs deps, and RUNS the capsule in the workspace (Studium never executes — pure
// delegation). Studium ingests this as the learner's OWN executed result and gates "you actually ran it"
// on `ran && passed`. Lenient by design: extra keys are ignored; a partial/invalid write parses to null
// (treated as "not ready, retry") so a half-written file never wedges the channel.
import { z } from "zod";
import type { ReferenceRun } from "@studium/lesson-bundle-schema";

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
