// run-trust.driver.ts — ENG-02: the confirmation a learner sees before a bundle's command runs, and the
// per-bundle trust memory. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/run-trust.driver.ts
import { runFingerprint, isTrusted, withTrusted, runConsent } from "./run-trust.js";
import { runManifestToTaskSpec, type RunManifest } from "./run-task.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const M: RunManifest = {
  capsule_ref: "capsule-demo", cmd: ["python", "run.py", "--note", "a b"], working_dir: "capsule",
  requirements: ["numpy==1.26.4", "scipy"], expected_outputs: ["o.csv"], verify_checks: [],
};
const bytes = new TextEncoder().encode('{"bundle":"v1"}');

// fingerprint: stable, hex sha-256, sensitive to the bundle bytes AND to every field that decides what runs.
{
  const a = runFingerprint(bytes, M);
  expect(/^[0-9a-f]{64}$/.test(a), "the fingerprint is a sha-256 hex digest");
  expect(a === runFingerprint(new TextEncoder().encode('{"bundle":"v1"}'), { ...M }), "same bundle and manifest → same fingerprint");
  expect(a !== runFingerprint(new TextEncoder().encode('{"bundle":"v2"}'), M), "a changed bundle changes the fingerprint");
  expect(a !== runFingerprint(bytes, { ...M, cmd: ["python", "evil.py"] }), "a changed command changes the fingerprint");
  expect(a !== runFingerprint(bytes, { ...M, requirements: ["numpy==1.26.4", "scipy", "extra"] }), "a changed package list changes the fingerprint");
  expect(a !== runFingerprint(bytes, { ...M, working_dir: "other" }), "a changed working_dir changes the fingerprint");
  expect(runFingerprint(null, M) !== a && /^[0-9a-f]{64}$/.test(runFingerprint(null, M)), "an unreadable bundle still yields a (different) fingerprint");
}

// trust memory: pure list helpers.
{
  const fp = runFingerprint(bytes, M);
  expect(!isTrusted([], fp), "nothing is trusted by default");
  const list = withTrusted([], fp);
  expect(isTrusted(list, fp), "a trusted fingerprint is remembered");
  expect(withTrusted(list, fp).length === 1, "trusting twice does not duplicate");
  expect(!isTrusted(list, runFingerprint(bytes, { ...M, cmd: ["x"] })), "another bundle is not trusted");
  let big: string[] = [];
  for (let i = 0; i < 300; i++) big = withTrusted(big, `fp${i}`);
  expect(big.length <= 200 && isTrusted(big, "fp299") && !isTrusted(big, "fp0"), "the memory is bounded and keeps the most recent");
}

// the confirmation text names the command, the packages and the folder, in the learner's language.
{
  const spec = runManifestToTaskSpec(M);
  const fr = runConsent(M, spec, "/work/space/capsule", "fr");
  expect(fr.detail.includes(spec.command), "the modal shows the exact command that will run");
  expect(fr.detail.includes("numpy==1.26.4") && fr.detail.includes("scipy"), "the modal lists the packages to install");
  expect(fr.detail.includes("/work/space/capsule"), "the modal shows the run folder");
  expect(fr.detail.includes("capsule-demo"), "the modal names the course");
  expect(fr.message.includes("Studium") && /autorise/.test(fr.message), "French message");
  expect(fr.runLabel === "Exécuter" && fr.trustLabel.startsWith("Exécuter et"), "French button labels");
  const en = runConsent(M, spec, "/work/space/capsule", "en");
  expect(/allow/.test(en.message) && en.runLabel === "Run", "English message and labels");
  const none = runConsent({ ...M, requirements: undefined }, runManifestToTaskSpec({ ...M, requirements: undefined }), "/w", "en");
  expect(none.detail.includes("none"), "no packages are shown as 'none'");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} run-trust assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — run-trust (confirmation + trust memory) passed all ${checks} assertions.`);
