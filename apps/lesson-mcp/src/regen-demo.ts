#!/usr/bin/env -S npx tsx
// regen-demo.ts — LIVE PROOF of per-run judgment REGENERATION quality. For a STOCHASTIC capsule the
// authored flaws (written for a canonical result) would mismatch the learner's real numbers; the host
// regenerates the flawed AI reading + answer key FROM THE LEARNER'S OWN run. This drives the live
// HttpLlmJudgmentGenerator on TWO different runs and shows the regenerated flaws ANCHOR on each run's
// actual landmark (different numbers ⇒ different, run-matched flaws).
//
//   LITELLM_BASE_URL=https://openrouter.ai/api LITELLM_API_KEY=$OPENROUTER_API_KEY \
//   LITELLM_MODEL=anthropic/claude-haiku-4.5 tsx apps/lesson-mcp/src/regen-demo.ts
//
// Offline (no LITELLM_BASE_URL) it uses the StubJudgmentGenerator (deterministic, also landmark-anchored).
import { StubJudgmentGenerator, HttpLlmJudgmentGenerator, type JudgmentGenerator, type JudgmentGenInput } from "@studium/lesson-session-host";

function makeGen(): { gen: JudgmentGenerator; mode: string } {
  const base = process.env["LITELLM_BASE_URL"];
  if (!base) return { gen: new StubJudgmentGenerator(), mode: "STUB (offline)" };
  const opts: { apiKey?: string; model?: string } = {};
  if (process.env["LITELLM_API_KEY"]) opts.apiKey = process.env["LITELLM_API_KEY"];
  if (process.env["LITELLM_MODEL"]) opts.model = process.env["LITELLM_MODEL"];
  return { gen: new HttpLlmJudgmentGenerator(base, opts), mode: `LIVE ${opts.model ?? "studium/judgment-generator"} @ ${base}` };
}

const RUNS = [
  { landmark: "LANDMARK k_fit=0.4212 half_life=1.6457", tag: "run A (seed 1)" },
  { landmark: "LANDMARK k_fit=0.0917 half_life=7.5589", tag: "run B (seed 2)" },
];

async function main(): Promise<void> {
  const { gen, mode } = makeGen();
  console.error(`[studium] per-run regen live proof — JudgmentGenerator = ${mode}\n`);
  for (const run of RUNS) {
    const input: JudgmentGenInput = {
      reference_run: { ran: true, passed: true, landmark: run.landmark, checks: [], provenance: { cmd: ["python", "scripts/run.py"], env: "uv" } } as never,
      concept_id: "c-kinetics",
      objective_text: "Interpréter une constante de vitesse k et la demi-vie d'une décroissance du premier ordre",
      n_flaws: 2,
    };
    const g = await gen.generateFlaw(input);
    const kval = run.landmark.match(/k_fit=([0-9.]+)/)?.[1] ?? "";
    console.error(`[${run.tag}]  ${run.landmark}`);
    console.error(`  flawed_content: ${g.flawed_content}`);
    console.error(`  claims: ${g.claims.map((c) => `${c.id}{${c.flaws_expected.join(",")}}`).join("  ")}`);
    console.error(`  anchors on THIS run's k (${kval})? ${g.flawed_content.includes(kval) ? "YES ✔" : "— (paraphrased)"}\n`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
