#!/usr/bin/env -S npx tsx
// over-distrust-demo.ts — LIVE PROOF that the OVER-DISTRUST direction of trust_calibration is now
// measurable. The keyword matcher can never report it (it only holds the planted-flaw key, so it can't
// tell a wrongly-flagged SOUND claim from praise). An LLM AuditJudge is told BOTH the planted flaws and
// the sound claims, so it detects a critique that WRONGLY flags a correct claim → false_positives > 0 →
// a NEGATIVE trust gap (over-distrust). We grade two critiques of the SAME grounded scene:
//   1. OVER-DISTRUSTING: rejects everything, including the sound claim  → fp>0 → trust < 0
//   2. CALIBRATED:       catches the real flaws, spares the sound claim → fp=0 → trust ≈ 0
//
//   LITELLM_BASE_URL=https://openrouter.ai/api LITELLM_API_KEY=$OPENROUTER_API_KEY \
//   LITELLM_MODEL=anthropic/claude-haiku-4.5 tsx apps/lesson-mcp/src/over-distrust-demo.ts
//
// Offline (no LITELLM_BASE_URL) it uses the StubAuditJudge, which by design reports fp=0 — so the demo
// also documents the honesty boundary: over-distrust stays 0 until a real judge is wired.
import { grade, type AuditJudge } from "@studium/lesson-session";
import { StubAuditJudge, HttpLlmAuditJudge, StubCritiqueEvaluator } from "@studium/lesson-session/node";

// trust_calibration gap from a single grounded audit — the EXACT formula the engine's recordJudgmentAudit
// folds (learner-state/index.ts): over_trust = missed/planted (credulous), over_distrust =
// min(fp,sound_total)/sound_total (over-skeptical, normalized by the SOUND population), gap = over_trust −
// over_distrust ∈ [-1,1]. Inlined so the demo needs no engine dep; with TRUST_CALIBRATION_LAMBDA=0.5 and
// no prior, the first sample's blended gap = gap/2.
function trustGap(a: { planted: number; caught: number; false_positives: number; sound_total: number }): number {
  if (a.planted === 0) return 0;
  const overTrust = Math.max(0, a.planted - a.caught) / a.planted;
  const overDistrust = a.sound_total > 0 ? Math.min(Math.max(0, a.false_positives), a.sound_total) / a.sound_total : 0;
  return 0.5 * (overTrust - overDistrust); // λ=0.5, no prior → first-sample blend
}

const REF = {
  ran: true, passed: true, landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", figure_path: "decay.png",
  checks: [{ check: "file exists: outputs/stats.csv", passed: true }],
  provenance: { capsule_doi: "10.0000/demo", cmd: ["python", "scripts/run.py"], env: "isolated uv venv" },
};

// A grounded spot_the_flaw: the AI reading plants TWO real flaws and states ONE sound fact.
const scene = {
  id: "s-flaw", type: "spot_the_flaw" as const, title: "Audite la lecture IA", objective_refs: [], concept_refs: ["c-kinetics"],
  estimated_seconds: 60, adaptation_hooks: [],
  flawed_content:
    "Lecture IA du run : k ≈ 0.42 est SANS DIMENSION (faux), donc la demi-vie DÉPASSE UNE HEURE (faux). " +
    "Par ailleurs, k est bien un TAUX du premier ordre estimé par ajustement de la décroissance (correct).",
  claims: [
    { id: "f-unit", text: "k serait sans dimension", flaws_expected: ["unites", "dimension"] },
    { id: "f-half", text: "la demi-vie dépasserait une heure", flaws_expected: ["demi-vie"] },
  ],
  // OVER-DISTRUST answer key: this assertion in the AI reading is CORRECT — flagging it is over-distrust.
  sound_claims: [{ id: "s-rate", text: "k est un taux du premier ordre estimé par ajustement" }],
  model_correction: "k est un taux (1/temps) ; la demi-vie vaut ln2/k ≈ 1.65 ; l'estimation par ajustement est correcte.",
  rubric: { completeness: 0.6, evidence_quality: 0.3, tone: 0.1 },
  reference_result: REF,
};

function makeJudge(): { judge: AuditJudge; mode: string } {
  const base = process.env["LITELLM_BASE_URL"];
  if (!base) return { judge: new StubAuditJudge(), mode: "STUB (offline — over-distrust stays 0 by design)" };
  const opts: { apiKey?: string; model?: string } = {};
  if (process.env["LITELLM_API_KEY"]) opts.apiKey = process.env["LITELLM_API_KEY"];
  if (process.env["LITELLM_MODEL"]) opts.model = process.env["LITELLM_MODEL"];
  return { judge: new HttpLlmAuditJudge(base, opts), mode: `LIVE ${opts.model ?? "studium/audit-judge"} @ ${base}` };
}

async function run(label: string, critique: string, judge: AuditJudge): Promise<void> {
  const r = await grade(scene as never, { kind: "flaw_report", text: critique }, { critiqueEvaluator: new StubCritiqueEvaluator(), auditJudge: judge });
  const ja = (r.signal as { judgment_audit?: { planted: number; caught: number; false_positives: number; sound_total: number } }).judgment_audit!;
  const gap = trustGap(ja);
  const dir = gap > 0.001 ? "OVER-TRUST (credulous)" : gap < -0.001 ? "OVER-DISTRUST (over-skeptical)" : "well-calibrated";
  console.error(`\n[${label}]`);
  console.error(`  critique: "${critique}"`);
  console.error(`  audit: planted=${ja.planted} caught=${ja.caught} false_positives=${ja.false_positives}/${ja.sound_total} sound`);
  console.error(`  → trust_calibration = ${gap.toFixed(3)}  (${dir})`);
}

async function main(): Promise<void> {
  const { judge, mode } = makeJudge();
  console.error(`[studium] over-distrust live proof — AuditJudge = ${mode}`);
  // 1. OVER-DISTRUSTING: dismisses the sound claim too.
  await run("over-distrusting auditor", "Tout est faux dans cette lecture : k sans dimension, la demi-vie, ET même le fait que k soit un taux estimé par ajustement — rien n'est fiable.", judge);
  // 2. CALIBRATED: catches the two real flaws, leaves the sound claim alone.
  await run("calibrated auditor", "Deux erreurs : k n'est pas sans dimension (c'est un taux, unités 1/temps) et la demi-vie ne dépasse pas une heure (≈1.65). En revanche, dire que k est un taux estimé par ajustement est correct.", judge);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
