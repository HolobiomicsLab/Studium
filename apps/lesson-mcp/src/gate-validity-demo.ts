// gate-validity-demo.ts — prints the synthetic-learner gate-validity table (Direction 2). Runs the four
// canonical dispositions through the REAL deck grader + folds + certification gate and shows what the
// instrument recovered (A' competence, criterion-c bias, signed gap) and whether each was certified.
// KEY-FREE and deterministic — no API key, no students. The table is the construct-validation evidence
// for "we hold a learner back on this number": the false-hold rate over should-advance learners is 0.
//
// Run:  tsx apps/lesson-mcp/src/gate-validity-demo.ts
import { runGateValidity, CANONICAL_LEARNERS } from "@studium/lesson-session";

const SHOULD_ADVANCE = new Set(["calibrated", "over-distruster"]);
const f = (x: number) => (Number.isNaN(x) ? "  n/a" : x.toFixed(2).padStart(5));

async function main(): Promise<void> {
  const rows = await runGateValidity(CANONICAL_LEARNERS, { scenes: 8, flawedPerScene: 4, soundPerScene: 4, seed: 12345 });
  console.error("[studium] gate-validity — synthetic learners through the REAL gate (key-free, 32 signal + 32 noise trials each)\n");
  console.error("  learner                        pFlaw pSound |   A'   c    gap  | certified  outcome");
  console.error("  " + "-".repeat(88));
  let falseHolds = 0;
  let falseAdvances = 0;
  for (const r of rows) {
    const shouldAdvance = SHOULD_ADVANCE.has(r.label);
    const outcome = r.certified === shouldAdvance ? "ok" : r.certified ? "FALSE-ADVANCE" : "FALSE-HOLD";
    if (!r.certified && shouldAdvance) falseHolds += 1;
    if (r.certified && !shouldAdvance) falseAdvances += 1;
    console.error(
      `  ${r.label.padEnd(30)} ${r.disposition.pFlagFlawed.toFixed(2)}  ${r.disposition.pFlagSound.toFixed(2)} ` +
      `| ${f(r.aPrime)} ${f(r.criterionC)} ${f(r.trustGap)} | ${(r.certified ? "yes" : "no ").padEnd(9)}  ${outcome}`,
    );
  }
  console.error("  " + "-".repeat(88));
  console.error(`\n  false-hold rate:    ${falseHolds}/${rows.filter((r) => SHOULD_ADVANCE.has(r.label)).length} (competent+calibrated learners wrongly withheld)`);
  console.error(`  false-advance rate: ${falseAdvances}/${rows.filter((r) => !SHOULD_ADVANCE.has(r.label)).length} (over-trusters wrongly certified)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
