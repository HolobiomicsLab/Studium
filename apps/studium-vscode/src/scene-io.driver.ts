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
import { FREE_TEXT_KIND, freeTextInput, extractConfidence } from "./scene-io.js";
import { calibrationVerdict } from "./calibration.js";
import { browserPhrases } from "./phrases.js";
import { RECALL_GRADES } from "./pane-messages.js";

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
const pane = readFileSync(resolve(here, "..", "..", "lesson-panel-ui", "dist", "vscode", "artifact-pane.js"), "utf8");
for (const kind of new Set(Object.values(EXPECTED))) {
  expect(new RegExp(`kind:\\s*"${kind}"`).test(pane), `artifact-pane.js posts input kind "${kind}"`);
}
expect(/type:\s*"turn"/.test(pane), `artifact-pane.js posts a {type:"turn"} discussion message`);
expect(/type:\s*"end"/.test(pane), `artifact-pane.js posts a {type:"end"} forget message`);
// the pane must render the previously-dropped distinguishing fields (incl. the quiz/meta prompts)
for (const field of ["artifact_a", "artifact_b", "source_content", "ai_summary", "scenario", "seed_claim", "steps", "question", "pre_question", "scale_labels"]) {
  expect(pane.includes(field), `artifact-pane.js renders scene field "${field}"`);
}

// 3) calibration verdict — verbatim port of host.ts. Band thresholds + null until MEASURED.
expect(calibrationVerdict({ concept_id: "c", total_attempts: 0, confidence_calibration: 0.9, calibration_samples: 0 }) === null, "no attempt → null");
// MEASURED guard: attempts>0 but NO confidence sample → null (never fabricate a "bien calibrée" verdict)
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.1 }) === null, "attempts but no calibration sample → null");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.1, calibration_samples: 1 })?.band === "bien", "|gap|<0.4 → bien");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.5, calibration_samples: 1 })?.band === "sur", "gap>0.4 → sur (overconfident)");
expect(calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: -0.5, calibration_samples: 1 })?.band === "sous", "gap<-0.4 → sous (underconfident)");
expect((calibrationVerdict({ concept_id: "c", total_attempts: 3, confidence_calibration: 0.5, calibration_samples: 1 })?.message || "").includes("surconfiant"), "sur message wording preserved");

// 4) per-answer confidence token (the notebook tap) — extractConfidence parses a trailing conf:N.
{
  const a = extractConfidence("ma critique conf:3");
  expect(a.confidence === 3 && a.rest === "ma critique", "extractConfidence parses 'conf:3' + strips the token");
  const b = extractConfidence("b conf 2");
  expect(b.confidence === 2 && b.rest === "b", "extractConfidence parses the space form 'conf 2'");
  const c = extractConfidence("réponse confidence=4");
  expect(c.confidence === 4, "extractConfidence accepts 'confidence=4'");
  const d = extractConfidence("just my answer");
  expect(d.confidence === undefined && d.rest === "just my answer", "no token → confidence undefined, text untouched");
  const e = extractConfidence("3");
  expect(e.confidence === undefined && e.rest === "3", "a bare digit is NOT a token (meta_checkpoint digit untouched)");
}
// parity: the webview pane must also attach a `confidence` to a submitted input (the tap mirrors this).
expect(/confidence/.test(pane), "artifact-pane.js attaches a confidence to a submitted input (the tap)");

// 5) VSC-5: both catalogues are complete and distinct. English inherited from the French table (the old
//    `...FR` spread) is what put « Hint » and « Continue ▸ » in a French pane; a value equal in both
//    languages must be a true cognate, listed here on purpose.
{
  const fr = browserPhrases("fr") as Record<string, string>;
  const en = browserPhrases("en") as Record<string, string>;
  const SAME_ON_PURPOSE = new Set([
    "chat_source", "chat_situation", "notebook_figure", "pane_badge_code", "pane_badge_image", "pane_situation",
    "pane_signal_justification", "pane_signal_question", "pane_type_discussion", "pane_type_intro",
    "pane_type_quiz", "pane_type_reproduction",
  ]);
  expect(Object.keys(fr).sort().join("|") === Object.keys(en).sort().join("|"), "fr and en catalogues define the same keys");
  for (const key of Object.keys(fr)) {
    if (SAME_ON_PURPOSE.has(key)) expect(fr[key] === en[key], `"${key}" is listed as a cognate, so fr and en are equal`);
    else expect(fr[key] !== en[key], `"${key}" is translated (fr and en differ: "${fr[key]}")`);
  }
  // The French pane chrome speaks French: none of these English words may be a French value.
  for (const key of Object.keys(fr).filter((k) => k.startsWith("pane_") || k.startsWith("graph_"))) {
    expect(!/\b(?:Hint|Continue|Mastery|Artifacts?|Reference run|landmark|Lesson complete|Submit critique|no artifact)\b/.test(fr[key]), `fr "${key}" carries no English chrome ("${fr[key]}")`);
  }
}

// 6) The pane's key-class table (which chip a scene type wears) mirrors the canonical table of
//    packages/lesson-session-host/src/key-class.ts; the pane is browser JS and cannot import it.
{
  const canonicalSrc = readFileSync(resolve(here, "..", "..", "..", "packages", "lesson-session-host", "src", "key-class.ts"), "utf8");
  const tableOf = (src: string, anchor: RegExp) => {
    const start = src.search(anchor);
    const body = start < 0 ? "" : src.slice(start, src.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/(\w+):\s*"(ungraded|author_keyed|production|externally_grounded)"/g)].map((m) => [m[1], m[2]]));
  };
  const canonical = tableOf(canonicalSrc, /SCENE_KEY_CLASS[^=]*=/);
  const mirrored = tableOf(pane, /const KEY_CLASS\s*=/);
  expect(Object.keys(canonical).length === 13, `the canonical key-class table lists the 13 scene types (got ${Object.keys(canonical).length})`);
  expect(JSON.stringify(Object.entries(mirrored).sort()) === JSON.stringify(Object.entries(canonical).sort()), "artifact-pane.js KEY_CLASS mirrors SCENE_KEY_CLASS");
}

// 7) C4 and VSC-8: the messages the pane posts for a self-rating and for an in-pane run, with the grade
//    list the host validates (pane-messages.ts RECALL_GRADES).
expect(/type:\s*"rateRecall",\s*sceneId[^}]*grade/.test(pane), `artifact-pane.js posts {type:"rateRecall", sceneId, grade}`);
expect(/type:\s*"run"/.test(pane), `artifact-pane.js posts a {type:"run"} message`);
{
  const m = pane.match(/const RECALL_GRADES\s*=\s*\[([^\]]*)\]/);
  const grades = m ? [...m[1].matchAll(/"([a-z]+)"/g)].map((g) => g[1]) : [];
  expect(grades.join("|") === RECALL_GRADES.join("|"), `artifact-pane.js offers exactly the grades the host accepts (got ${grades.join(",")})`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} scene-io assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — scene-io + calibration + webview-parity passed all ${checks} assertions.`);
