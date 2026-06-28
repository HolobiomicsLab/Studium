// run-task.driver.ts — standalone tsx unit test for run-task.ts: the learner-time RUN manifest →
// native VS Code task command, the verify-check evaluation, and the run_result.json assembly (the
// ran && passed gate that the host's submit_run_result keys on). No VS Code APIs — pure logic.
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/run-task.driver.ts
import {
  runManifestToTaskSpec,
  evaluateChecks,
  buildRunResult,
  type RunManifest,
} from "./run-task.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const MANIFEST: RunManifest = {
  capsule_ref: "fixtures/capsule-demo",
  cmd: ["python", "scripts/run.py", "--seed", "1"],
  working_dir: "capsule",
  requirements: ["numpy==1.26.4", "scipy"],
  expected_outputs: ["outputs/stats.csv"],
  verify_checks: ["file exists: outputs/stats.csv"],
};

// 1) task spec: provisions (install) then runs cmd, in the manifest's working_dir.
{
  const spec = runManifestToTaskSpec(MANIFEST);
  expect(spec.cwd === "capsule", "cwd is the manifest working_dir");
  expect(spec.command.includes("pip install"), "install step present when requirements declared");
  expect(spec.command.includes("numpy==1.26.4") && spec.command.includes("scipy"), "requirements listed");
  expect(spec.command.includes("python scripts/run.py --seed 1"), "run cmd present after &&");
  expect(spec.command.indexOf("pip install") < spec.command.indexOf("python"), "install precedes run");
  expect(spec.name.includes("capsule-demo") || spec.name.includes("fixtures/capsule-demo"), "name references the capsule_ref");
}

// 2) no requirements + no working_dir → no install step, cwd "."
{
  const spec = runManifestToTaskSpec({ capsule_ref: "c", cmd: ["bash", "run.sh"], expected_outputs: [], verify_checks: [] });
  expect(spec.cwd === ".", "cwd defaults to '.' when no working_dir");
  expect(!spec.command.includes("pip install"), "no install step without requirements");
  expect(spec.command === "bash run.sh", "command is just the run cmd");
}

// 3) injectable installer (e.g. uv) + shell-quoting of odd args.
{
  const spec = runManifestToTaskSpec(
    { capsule_ref: "c", cmd: ["python", "run.py", "--note", "a b"], requirements: ["pkg"], expected_outputs: [], verify_checks: [] },
    { pip: "uv pip install" },
  );
  expect(spec.command.startsWith("uv pip install pkg &&"), "custom installer threaded");
  expect(spec.command.includes("'a b'"), "arg with a space is shell-quoted");
}

// 4) verify checks: 'file exists' resolves under working_dir; unknown checks are NOT passed.
{
  const present = new Set(["capsule/outputs/stats.csv"]);
  const fe = (p: string) => present.has(p);
  const r = evaluateChecks(MANIFEST, fe);
  expect(r.length === 1 && r[0]!.passed === true, "file-exists check passes when the file is present");
  const r2 = evaluateChecks({ ...MANIFEST, verify_checks: ["file exists: outputs/missing.csv", "stdout contains: k="] }, fe);
  expect(r2[0]!.passed === false, "missing file → check fails");
  expect(r2[1]!.passed === false, "unrecognized check kind → conservatively NOT passed");
}

// 5) buildRunResult: ran/passed gate (host keys submit_run_result on ran && passed).
{
  const present = new Set(["capsule/outputs/stats.csv"]);
  const fe = (p: string) => present.has(p);
  const ok = buildRunResult(MANIFEST, { exitCode: 0, fileExists: fe, landmark: "k_fit=0.42" });
  expect(ok.ran === true && ok.passed === true, "exit 0 + outputs present + checks pass → ran && passed");
  expect(ok.landmark === "k_fit=0.42", "learner landmark carried");
  expect(ok.artifacts.includes("capsule/outputs/stats.csv"), "present expected_outputs listed as artifacts");
  expect(ok.provenance.env === "vscode workspace", "provenance marks the workspace run");

  const notRun = buildRunResult(MANIFEST, { exitCode: null, fileExists: fe });
  expect(notRun.ran === false && notRun.passed === false, "task never spawned (exitCode null) → ran=false");

  const nonzero = buildRunResult(MANIFEST, { exitCode: 1, fileExists: fe });
  expect(nonzero.ran === true && nonzero.passed === false, "nonzero exit → ran but NOT passed");

  const missingOut = buildRunResult(MANIFEST, { exitCode: 0, fileExists: () => false });
  expect(missingOut.passed === false, "expected output missing → not passed (even on exit 0)");
  expect(missingOut.landmark === null, "no landmark supplied → null (author landmark withheld)");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} run-task assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — run-task (manifest→task + verify + run_result gate) passed all ${checks} assertions.`);
