// host-phrases.driver.ts — the host-side catalogues cover the same keys in French and English, no value
// is left in the wrong language, and placeholders agree. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/host-phrases.driver.ts
import { HOST_CATALOGUES, hostPhrase, type HostPhraseKey } from "./host-phrases.js";
import { browserPhrases } from "./phrases.js";

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
// Changed: compared without typographic spaces — the French catalogue is now typeset (UX-12), so the space before
// the colon is a no-break space.
expect(fr.run_confirm_detail.replace(/\u00a0/g, " ").includes("Capsule : {capsule}") && en.run_confirm_detail.includes("Capsule: {capsule}"),
  "the run confirmation labels capsule_ref « Capsule »");
expect(!fr.run_confirm_detail.includes("Cours : {capsule}") && !en.run_confirm_detail.includes("Course: {capsule}"), "and never « Cours »");
// W5 review: « Forget my data » says what it erases (this extension's storage) and where the assistants'
// data lives, which it does not touch.
expect(fr.forget_data_prompt.includes("cette extension") && en.forget_data_prompt.includes("this extension"),
  "the forget prompt names what is erased: this extension's data");
expect(!/toutes les données|all Studium/i.test(fr.forget_data_prompt + en.forget_data_prompt), "it no longer claims to erase all Studium data");
expect(fr.forget_data_prompt.includes("{harness_data}") && en.forget_data_prompt.includes("{harness_data}"),
  "it names the folder where the assistants' Studium data lives");

// UX-12 / L-5: the host catalogue follows the pane's French typography (no-break spaces before : ; ! ? and inside
// « », so a status line never starts with a colon) and its register: the learner is « tu » everywhere, plurals are
// written out (never « notion(s) »), English quotes are “ ” and French ones « ».
for (const key of keys) {
  expect(!/ [:;!?»]|« /.test(fr[key]), `${key}: French typography (no plain space before punctuation): ${JSON.stringify(fr[key])}`);
  expect(!/\b(vous|votre|vos)\b/i.test(fr[key]), `${key}: the learner is addressed as « tu »: ${fr[key]}`);
  expect(!/\(s\)/.test(fr[key]) && !/\(s\)/.test(en[key]), `${key}: plural written out, never « (s) »`);
  expect(!/[«»"]/.test(en[key]), `${key}: English uses “ ” quotes: ${en[key]}`);
  expect(!/"/.test(fr[key]), `${key}: French uses « » quotes: ${fr[key]}`);
}
// The same rules over the pane's catalogue (L-5): « tu », typeset, plurals written out, quotes by language.
{
  const paneFr = browserPhrases("fr") as Record<string, string>;
  const paneEn = browserPhrases("en") as Record<string, string>;
  for (const [key, value] of Object.entries(paneFr)) {
    expect(!/\b(vous|votre|vos)\b/i.test(value), `pane ${key}: the learner is addressed as « tu »: ${value}`);
    expect(!/ [:;!?»]|« /.test(value), `pane ${key}: French typography: ${JSON.stringify(value)}`);
    expect(!/\(s\)|·s\b/.test(value), `pane ${key}: plural written out: ${value}`);
    expect(!/"/.test(value), `pane ${key}: French quotes: ${value}`);
  }
  for (const [key, value] of Object.entries(paneEn)) expect(!/[«»"]|\(s\)/.test(value), `pane ${key}: English quotes and plurals: ${value}`);
}
expect(hostPhrase("review_nothing_due", { date: "jeudi" }, "fr").includes("\u00a0: jeudi"), "the review notice is typeset (a no-break space before its colon)");
// UX-01: erasing says what is actually lost — progress, the cross-lesson profile and the review schedule of every
// lesson — and what stays (the assistants' data), in both the command's prompt and the pane's.
expect(/profil/.test(fr.forget_data_prompt) && /révisions de toutes tes leçons/.test(fr.forget_data_prompt), `the command's prompt names the profile and every lesson's reviews (fr: ${fr.forget_data_prompt})`);
{
  const pane = (locale: "fr" | "en", key: string) => (browserPhrases(locale) as Record<string, string>)[key] ?? "";
  // The pane's « M'oublier » calls forget_session, which erases this lesson's progress and the profile and study
  // record shared by every lesson (L-11/L-13), and keeps the library lesson and its sources.
  expect(/profil/.test(pane("fr", "extension_forget_prompt")) && /révisions de toutes tes leçons/.test(pane("fr", "extension_forget_prompt"))
    && /restent/.test(pane("fr", "extension_forget_prompt")), `the pane's forget prompt says what is erased and what stays (${pane("fr", "extension_forget_prompt")})`);
  expect(/profile/.test(pane("en", "extension_forget_prompt")) && /all your lessons/.test(pane("en", "extension_forget_prompt")) && /stay/.test(pane("en", "extension_forget_prompt")), "and in English");
  expect(!/de cette session|for this session/.test(pane("fr", "extension_forget_prompt") + pane("en", "extension_forget_prompt") + pane("fr", "pane_forget_title") + pane("en", "pane_forget_title")),
    "it never says only « this session » is erased");
}
expect(/profile/.test(en.forget_data_prompt) && /reviews of all your lessons/.test(en.forget_data_prompt), `and in English (${en.forget_data_prompt})`);

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} host-phrases assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — host-phrases (fr/en parity) passed all ${checks} assertions.`);
