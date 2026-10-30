// host-phrases.driver.ts — the host-side catalogues cover the same keys in French and English, no value
// is left in the wrong language, and placeholders agree. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/host-phrases.driver.ts
import { HOST_CATALOGUES, hostPhrase, type HostPhraseKey } from "./host-phrases.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const fr = HOST_CATALOGUES.fr;
const en = HOST_CATALOGUES.en;
const keys = Object.keys(fr) as HostPhraseKey[];
// Strings that are identical in both languages on purpose (a product name alone).
const SAME_ON_PURPOSE = new Set<HostPhraseKey>(["status_idle"]);
const placeholders = (s: string) => [...s.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort().join(",");

expect(keys.length === Object.keys(en).length, "French and English define the same number of keys");
for (const key of keys) {
  expect(typeof en[key] === "string" && en[key].length > 0, `${key}: English value present`);
  expect(SAME_ON_PURPOSE.has(key) || fr[key] !== en[key], `${key}: French and English differ`);
  expect(placeholders(fr[key]) === placeholders(en[key]), `${key}: same placeholders in both languages`);
  expect(!/ \/ /.test(fr[key]) && !/ \/ /.test(en[key]), `${key}: not a slash-bilingual label`);
}
expect(hostPhrase("status_due", { count: 2 }, "fr") === "Studium · 2 à réviser", "French status bar text");
expect(hostPhrase("status_due", { count: 2 }, "en") === "Studium · 2 to review", "English status bar text");
expect(hostPhrase("reviews_next", {}, "en").includes("{date}"), "an unfilled placeholder is left visible, not blanked");
// W5 review: the run confirmation labels the capsule_ref it shows as a capsule, not a course.
expect(fr.run_confirm_detail.includes("Capsule : {capsule}") && en.run_confirm_detail.includes("Capsule: {capsule}"),
  "the run confirmation labels capsule_ref « Capsule »");
expect(!fr.run_confirm_detail.includes("Cours : {capsule}") && !en.run_confirm_detail.includes("Course: {capsule}"), "and never « Cours »");
// W5 review: « Forget my data » says what it erases (this extension's storage) and where the assistants'
// data lives, which it does not touch.
expect(fr.forget_data_prompt.includes("cette extension") && en.forget_data_prompt.includes("this extension"),
  "the forget prompt names what is erased: this extension's data");
expect(!/toutes les données|all Studium/i.test(fr.forget_data_prompt + en.forget_data_prompt), "it no longer claims to erase all Studium data");
expect(fr.forget_data_prompt.includes("{harness_data}") && en.forget_data_prompt.includes("{harness_data}"),
  "it names the folder where the assistants' Studium data lives");

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} host-phrases assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — host-phrases (fr/en parity) passed all ${checks} assertions.`);
