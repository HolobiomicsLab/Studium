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
  extractLandmark,
  workingDirProblem,
  compileBoundedPattern,
  MAX_PATTERN_LENGTH,
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
  const r2 = evaluateChecks({ ...MANIFEST, verify_checks: ["file exists: outputs/missing.csv", "totally unknown check"] }, fe);
  expect(r2[0]!.passed === false, "missing file → check fails");
  expect(r2[1]!.passed === false, "unrecognized check kind → conservatively NOT passed");
}

// 4b) extractLandmark: last-non-empty-line heuristic; optional regex; null when nothing matches.
{
  const stdout = "installing…\nrunning pipeline\nMODIFIED_COSINE=0.6477 MATCHED_PEAKS=7\n\n";
  expect(extractLandmark(stdout) === "MODIFIED_COSINE=0.6477 MATCHED_PEAKS=7", "last non-empty line is the landmark by default");
  expect(extractLandmark(stdout, "MODIFIED_COSINE=([0-9.]+)") === "0.6477", "landmark_pattern isolates its capturing group");
  expect(extractLandmark("noise only\nmore noise", "SCORE=([0-9.]+)") === null, "no pattern match → null (run gets quarantined)");
  expect(extractLandmark("", ) === null, "empty stdout → null landmark");
  expect(extractLandmark("one\n[weird regex", "(") === null, "an invalid regex is handled → null, never throws");
}

// 4c) stdout-contains + landmark-matches check forms (presence/FORM only, never a value).
{
  const fe = () => false;
  const ctx = { landmark: "MODIFIED_COSINE=0.6477 MATCHED_PEAKS=7", stdout: "pipeline done\nMODIFIED_COSINE=0.6477 MATCHED_PEAKS=7" };
  const r = evaluateChecks(
    { ...MANIFEST, verify_checks: ["stdout contains: MATCHED_PEAKS", "landmark matches: MODIFIED_COSINE=[0-9.]+", "stdout contains: NOPE"] },
    fe, ctx,
  );
  expect(r[0]!.passed === true, "'stdout contains' passes when the marker is in captured stdout");
  expect(r[1]!.passed === true, "'landmark matches' passes when the landmark has the expected FORM");
  expect(r[2]!.passed === false, "'stdout contains' fails when the marker is absent");
  // with no captured context, presence/form checks conservatively fail (never falsely pass)
  const r2 = evaluateChecks({ ...MANIFEST, verify_checks: ["landmark matches: X=[0-9]+"] }, fe);
  expect(r2[0]!.passed === false, "no captured landmark → form check conservatively fails");
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

// 5b) checks are evaluated against FULL stdout; only the STORED stdout_tail is bounded (regression:
// an early `stdout contains:` marker in a >4000-char run must not be silently dropped and quarantined).
{
  const bigEarly = "MARKER_EARLY\n" + "x".repeat(5000) + "\nMODIFIED_COSINE=0.6477";
  const m2: RunManifest = { ...MANIFEST, expected_outputs: [], verify_checks: ["stdout contains: MARKER_EARLY"] };
  const r = buildRunResult(m2, { exitCode: 0, fileExists: () => true, landmark: "MODIFIED_COSINE=0.6477", stdout: bigEarly });
  expect(r.checks[0]!.passed === true, "early stdout marker in a >4000-char run still passes (checks see FULL stdout)");
  expect(r.passed === true, "a successful long run with an early marker is not wrongly quarantined");
  expect((r.stdout_tail || "").length <= 4000, "stdout_tail is bounded to 4000 chars on the wire");
}

// 6) ENG-02: a bundle-supplied working_dir must stay inside the workspace folder.
{
  expect(workingDirProblem(undefined) === null, "no working_dir is fine");
  expect(workingDirProblem("") === null, "an empty working_dir is fine");
  expect(workingDirProblem("capsule") === null, "a plain relative working_dir is fine");
  expect(workingDirProblem("capsule/sub dir/x") === null, "a nested relative working_dir is fine");
  expect(workingDirProblem("./capsule") === null, "a leading ./ is fine");
  expect(workingDirProblem("/etc") === "absolute", "a POSIX absolute path is refused");
  expect(workingDirProblem("\\\\server\\share") === "absolute", "a UNC path is refused");
  expect(workingDirProblem("C:\\Users\\x") === "absolute", "a Windows drive path is refused");
  expect(workingDirProblem("c:/x") === "absolute", "a lower-case Windows drive path is refused");
  expect(workingDirProblem("..") === "parent", "a bare .. is refused");
  expect(workingDirProblem("../x") === "parent", "a leading ../ is refused");
  expect(workingDirProblem("a/../../x") === "parent", "an embedded .. segment is refused");
  expect(workingDirProblem("a\\..\\b") === "parent", "a backslash-separated .. is refused");
  expect(workingDirProblem("a..b/c") === null, "a name merely containing two dots is fine");
}

// 7) ENG-02: landmark_pattern comes from the bundle and runs on stdout; it must be bounded.
{
  expect(compileBoundedPattern("MODIFIED_COSINE=([0-9.]+)") instanceof RegExp, "an ordinary pattern compiles");
  expect(compileBoundedPattern("x".repeat(MAX_PATTERN_LENGTH + 1)) === null, "an over-long pattern is rejected");
  expect(compileBoundedPattern("x".repeat(MAX_PATTERN_LENGTH)) instanceof RegExp, "a pattern at the cap is accepted");
  expect(compileBoundedPattern("(a+)+$") === null, "a quantified group holding a quantifier (catastrophic backtracking) is rejected");
  expect(compileBoundedPattern("(.*)*x") === null, "(.*)* is rejected");
  expect(compileBoundedPattern("a+b+c+d+e+") === null, "more than four unbounded quantifiers is rejected");
  expect(compileBoundedPattern("(") === null, "an invalid pattern is null, never throws");
  expect(extractLandmark("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "(a+)+$") === null, "a catastrophic landmark_pattern returns null instantly");
  const big = "noise\n".repeat(50000) + "SCORE=0.5\n";
  expect(extractLandmark(big, "SCORE=([0-9.]+)") === "0.5", "the landmark on the last line of a long stdout is still found");
  const r = evaluateChecks({ ...MANIFEST, verify_checks: ["landmark matches: (a+)+$"] }, () => false, { landmark: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!" });
  expect(r[0]!.passed === false, "a catastrophic 'landmark matches' pattern fails the check without hanging");
}

// 8) ENG-02 (reviewer): the syntactic filter alone is not enough — these shapes backtrack catastrophically
// and used to be accepted. Each must now return promptly (rejected by the filter OR cut off by the match
// time limit), and the whole group must finish well inside the budget.
{
  const t0 = Date.now();
  const catastrophic: Array<[string, string]> = [
    ["((a+))+$", "a".repeat(80) + "!"],
    ["(.*a){12}x", "a".repeat(80)],
    ["(.*a){8}x", "a".repeat(80)],
    ["(a|aa)+$", "a".repeat(80) + "!"],
    ["\\d*\\d*\\d*\\d*x", "1".repeat(8000)],
  ];
  for (const [pat, input] of catastrophic) {
    const t = Date.now();
    expect(extractLandmark(input, pat) === null, `catastrophic pattern ${pat} yields no landmark`);
    expect(Date.now() - t < 2000, `catastrophic pattern ${pat} returns promptly (took ${Date.now() - t} ms)`);
    const t2 = Date.now();
    const r = evaluateChecks({ ...MANIFEST, verify_checks: [`landmark matches: ${pat}`] }, () => false, { landmark: input });
    expect(r[0]!.passed === false, `catastrophic 'landmark matches: ${pat}' fails the check`);
    expect(Date.now() - t2 < 2000, `catastrophic 'landmark matches: ${pat}' returns promptly`);
  }
  expect(Date.now() - t0 < 10000, "the catastrophic probes together finish inside the budget");
  // Ordinary patterns still work through the bounded matcher, including a quantified literal group.
  expect(extractLandmark("x\nSCORE=0.5", "SCORE=([0-9.]+)") === "0.5", "an ordinary landmark still extracts");
  expect(extractLandmark("ab ab ab", "(?:ab ){2}ab") === "ab ab ab", "a fixed repeat of a quantifier-free group is allowed");
  expect(compileBoundedPattern("(a+)*") === null, "an unbounded repeat of any group is rejected");
  expect(compileBoundedPattern("(?:ab)+") === null, "an unbounded repeat of a plain group is rejected");
  expect(compileBoundedPattern("SCORE=\\(([0-9.]+)\\)") instanceof RegExp, "escaped parentheses are not groups");
  expect(compileBoundedPattern("[()]+x") instanceof RegExp, "parentheses inside a character class are not groups");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} run-task assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — run-task (manifest→task + verify + run_result gate) passed all ${checks} assertions.`);
