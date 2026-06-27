// scene-io.driver.ts — standalone tsx unit test for the scene→input contract (scene-io.ts) + the
// calibration verdict port (calibration.ts), plus a TEXT-PARITY guard that the webview pane
// (media/artifact-pane.js) submits the same response kinds (it can't import the TS module, so it
// mirrors the kinds by hand — this asserts they did not drift).
//
// Run from the repo root:
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/scene-io.driver.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FREE_TEXT_KIND, freeTextInput } from "./scene-io.js";
import { calibrationVerdict } from "./calibration.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// 1) the scene→kind contract MUST match the server-side graders (packages/lesson-session graders.ts:
//    each grader throws unless input.kind equals the value below).
const EXPECTED: Record<string, string> = {
  ai_critique: "critique",
  spot_the_flaw: "flaw_report",
  explain_back: "explanation",
  comparison: "comparison",
  summary_audit: "summary_audit",
  prompt_practice: "prompt_submission",
  communication_sim: "communication",
};
for (const [type, kind] of Object.entries(EXPECTED)) {
  expect(FREE_TEXT_KIND[type] === kind, `FREE_TEXT_KIND["${type}"] === "${kind}" (got "${FREE_TEXT_KIND[type]}")`);
  const inp = freeTextInput(type, "hello") as any;
  expect(!!inp && inp.kind === kind && inp.text === "hello", `freeTextInput("${type}","hello") → {kind:"${kind}",text:"hello"}`);
}
// ack-graded / control scenes have NO free-text kind → null (caller falls back to ack / quiz / meta).
for (const type of ["intro", "concept", "quiz", "meta_checkpoint", "reproduction", "discussion"]) {
  expect(freeTextInput(type, "x") === null, `freeTextInput("${type}") === null`);
}

// 2) webview PARITY — media/artifact-pane.js must post every one of those kinds, plus the new
//    discussion-turn + forget messages, so the pane agrees with the notebook + the graders.
const pane = readFileSync(resolve(here, "..", "media", "artifact-pane.js"), "utf8");
for (const kind of new Set(Object.values(EXPECTED))) {
  expect(new RegExp(`kind:\\s*"${kind}"`).test(pane), `artifact-pane.js posts input kind "${kind}"`);
}
expect(/type:\s*"turn"/.test(pane), `artifact-pane.js posts a {type:"turn"} discussion message`);
expect(/type:\s*"end"/.test(pane), `artifact-pane.js posts a {type:"end"} forget message`);
// the pane must render the previously-dropped distinguishing fields
for (const field of ["artifact_a", "artifact_b", "source_content", "ai_summary", "scenario", "seed_claim", "steps"]) {
  expect(pane.includes(field), `artifact-pane.js renders scene field "${field}"`);
}

// 3) calibration verdict — verbatim port of host.ts. Band thresholds + null-before-attempt.
expect(calibrationVerdict({ concept_id: "c", total_attempts: 0, confidence_calibration: 0.9 }) === null, "no attempt → null");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.1 })?.band === "bien", "|gap|<0.4 → bien");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.5 })?.band === "sur", "gap>0.4 → sur (overconfident)");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: -0.5 })?.band === "sous", "gap<-0.4 → sous (underconfident)");
expect((calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.5 })?.message || "").includes("surconfiant"), "sur message wording preserved");

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} scene-io assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — scene-io + calibration + webview-parity passed all ${checks} assertions.`);
