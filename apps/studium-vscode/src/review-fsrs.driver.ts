// review-fsrs.driver.ts — a standalone tsx driver asserting the extension's client-side FSRS mirror
// (review-fsrs.ts) is numerically IDENTICAL to the authoritative scheduler
// packages/adaptation-engine/src/fsrs.ts. The extension can't import the engine package, so this
// driver pins the copy against drift.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/review-fsrs.driver.ts
//
// Exits non-zero (and prints FAIL) on any mismatch.
import { resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as mirror from "./review-fsrs.js";

// Works whether tsx loads this as ESM (import.meta.url) or CJS (__dirname).
function hereDir(): string {
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) return dirname(fileURLToPath(import.meta.url));
  } catch { /* fall through */ }
  return typeof __dirname !== "undefined" ? __dirname : process.cwd();
}

async function main() {
  const fsrsUrl = pathToFileURL(
    resolve(hereDir(), "../../../packages/adaptation-engine/src/fsrs.ts"),
  ).href;
  const fsrs: any = await import(fsrsUrl);

  const t0 = Date.parse("2026-06-20T10:00:00Z");
  const grades: Array<{ correct: boolean; hint: number }> = [
    { correct: true, hint: 0 },
    { correct: true, hint: 2 },
    { correct: false, hint: 0 },
  ];
  const probes = [60_000, 7 * 86_400_000, 30 * 86_400_000, 90 * 86_400_000];

  let checks = 0;
  const failures: string[] = [];
  const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

  for (const g of grades) {
    // mirror memory
    const grade = mirror.gradeFromAnswer(g.correct, g.hint);
    const mMem = mirror.reviewMemory({ stability: 0, difficulty: 0, last: null, reps: 0 }, grade, t0);
    // real fsrs memory
    let rMem = fsrs.defaultMemoryState("c1");
    rMem = fsrs.reviewMemory(rMem, fsrs.gradeFromAnswer({ correct: g.correct, hint_count: g.hint }), t0);

    for (const p of probes) {
      const now = t0 + p;
      const mR = mirror.retrievability(mMem, now);
      const rR = fsrs.retrievability(rMem, now);
      const mDue = mirror.isDue(mMem, now);
      const rDue = fsrs.isDue(rMem, now);
      const mDueAt = mirror.dueAt(mMem);
      const rDueAt = fsrs.dueAt(rMem);
      checks += 3;
      if (!approx(mR, rR)) failures.push(`retrievability g=${grade} p=${p}: mirror=${mR} fsrs=${rR}`);
      if (mDue !== rDue) failures.push(`isDue g=${grade} p=${p}: mirror=${mDue} fsrs=${rDue}`);
      if (!approx(mDueAt, rDueAt)) failures.push(`dueAt g=${grade}: mirror=${mDueAt} fsrs=${rDueAt}`);
    }
  }

  if (failures.length) {
    console.error(`FAIL — ${failures.length}/${checks} parity checks diverged:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`OK — extension FSRS mirror matches fsrs.ts on all ${checks} checks.`);
}

main().catch((e) => {
  console.error("driver error:", e);
  process.exit(1);
});
