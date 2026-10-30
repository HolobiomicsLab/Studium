// study-status.driver.ts — VSC-6: the "n à réviser" status-bar text and the Reviews tree node, fed by the
// result of get_next_reinforcement. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/study-status.driver.ts
import { parseReinforcement, statusBarText, reviewsNode, reviewStartReply } from "./study-status.js";
import { hostPhrase } from "./host-phrases.js";
import { buildLessonTree } from "./lesson-tree.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const target = (concept_id: string, scene_id: string | null = null) =>
  ({ concept_id, due_at: 1000, retrievability: 0.6, scene_id, source: "profile" });
const DUE = { reinforcement: target("c1"), due: [target("c1"), target("c2"), target("c1", "s9")], reason: "due", next_due_at: null };
const LATER = { reinforcement: null, due: [], reason: "nothing_due", next_due_at: 1_800_000_000_000 };
const FRESH = { reinforcement: null, due: [], reason: "no_history", next_due_at: null };

// parseReinforcement
{
  const s = parseReinforcement(DUE);
  expect(s.dueCount === 3 && s.hasHistory, "three due targets are counted");
  expect(JSON.stringify(s.concepts) === '["c1","c2"]', "concepts are de-duplicated, in priority order");
  const l = parseReinforcement(LATER);
  expect(l.dueCount === 0 && l.hasHistory && l.nextDueAt === 1_800_000_000_000, "nothing_due keeps the next due date");
  const f = parseReinforcement(FRESH);
  expect(f.dueCount === 0 && !f.hasHistory, "no_history is reported as no history");
  const junk = parseReinforcement({});
  expect(junk.dueCount === 0 && !junk.hasHistory && junk.concepts.length === 0, "an unrecognised payload is an empty status, never a throw");
  expect(parseReinforcement(null as any).dueCount === 0, "a null payload is an empty status");
}

// statusBarText: shown only when something is due
{
  const s = parseReinforcement(DUE);
  expect(statusBarText(s, "fr")?.text === "Studium · 3 à réviser", "French status bar text");
  expect(statusBarText(s, "en")?.text === "Studium · 3 to review", "English status bar text");
  expect(!!statusBarText(s, "en")?.tooltip.includes("3"), "the tooltip carries the count");
  expect(statusBarText(parseReinforcement(LATER), "fr") === null, "nothing due → no status bar item");
  expect(statusBarText(parseReinforcement(FRESH), "fr") === null, "no history → no status bar item");
  expect(statusBarText(null, "fr") === null, "unknown status → no status bar item");
}

// reviewsNode
{
  const fmt = (ms: number) => `D${ms}`;
  const due = reviewsNode(parseReinforcement(DUE), "fr", fmt)!;
  expect(due.id === "reviews" && due.label === "Révisions" && due.description === "3 à réviser", "due node: label and description");
  expect(due.children?.length === 2 && due.children[0]!.label === "c1", "one child per due concept");
  expect(due.children!.every((c) => !c.command), "concept leaves are informational");
  const later = reviewsNode(parseReinforcement(LATER), "en", fmt)!;
  expect(later.label === "Reviews" && later.children?.[0]?.label === "Nothing to review right now", "nothing due: says so");
  expect(later.children?.[1]?.label === "Next review: D1800000000000", "nothing due: shows the next review date");
  expect(reviewsNode(parseReinforcement(FRESH), "fr", fmt) === null, "no history → no Reviews node");
  expect(reviewsNode(null, "fr", fmt) === null, "unknown status → no Reviews node");
}

// the tree carries the Reviews node, and an empty tree is left to the welcome view
{
  const reviews = parseReinforcement(DUE);
  const t = buildLessonTree({ courses: [], community: [], onReproductionScene: false, reviews });
  expect(t.some((n) => n.id === "reviews"), "buildLessonTree includes the Reviews node");
  expect(!buildLessonTree({ courses: [], community: [], onReproductionScene: false }).some((n) => n.id === "reviews"), "no reviews option → no node");
  const empty = buildLessonTree({ courses: [], community: [], onReproductionScene: false, emptyAsWelcome: true });
  expect(empty.length === 0, "nothing to show + emptyAsWelcome → an empty tree (the welcome view takes over)");
  expect(buildLessonTree({ courses: [{ ref: "a/lesson.json", title: "A", target: "L1", language: "fr", validatedBy: "x" }], community: [], onReproductionScene: false, emptyAsWelcome: true }).length > 0, "a discovered course keeps the tree");
  expect(buildLessonTree({ courses: [], community: [], onReproductionScene: false, emptyAsWelcome: true, reviews }).length > 0, "due reviews keep the tree");
  expect(buildLessonTree({ courses: [], community: [], onReproductionScene: true, emptyAsWelcome: true }).length > 0, "a live reproduction scene keeps the tree");
}

// « Réviser maintenant » when start_review_session does not start: nothing due is a calm, localized notice with
// the next review date (W4 review: never an action error, never an empty message); a reply that is neither
// started nor nothing_due stays an error, worded by the host when the server sent no text.
{
  const date = (ms: number) => `D${ms}`;
  const later = reviewStartReply({ status: "nothing_due", next_review_at: 1_800_000_000_000, display_markdown: "" }, "fr", date);
  expect(later.type === "action_notice" && later.message === hostPhrase("review_nothing_due", { date: "D1800000000000" }, "fr"),
    `nothing due with a next date is a notice naming that date (got ${JSON.stringify(later)})`);
  const laterEn = reviewStartReply({ status: "nothing_due", next_review_at: 5 }, "en", date);
  expect(laterEn.type === "action_notice" && laterEn.message === hostPhrase("review_nothing_due", { date: "D5" }, "en"), "the notice follows the lesson language");
  const never = reviewStartReply({ status: "nothing_due", next_review_at: null, display_markdown: "Nothing scheduled." }, "fr", date);
  expect(never.type === "action_notice" && never.message === hostPhrase("review_nothing_scheduled", {}, "fr"),
    `nothing due and nothing scheduled is a notice in the pane's language (got ${JSON.stringify(never)})`);
  const odd = reviewStartReply({ status: "unexpected" }, "fr", date);
  expect(odd.type === "action_error" && odd.message === hostPhrase("review_unavailable", {}, "fr"), "an unknown reply without text is an error with a host phrase, never empty");
  const worded = reviewStartReply({ status: "unexpected", display_markdown: "Le serveur explique." }, "fr", date);
  expect(worded.type === "action_error" && worded.message === "Le serveur explique.", "an unknown reply keeps the server's own words");
  expect(reviewStartReply(null, "en", date).message === hostPhrase("review_unavailable", {}, "en"), "a null reply is worded, never empty");
  const real = reviewStartReply({ status: "nothing_due", next_review_at: Date.UTC(2026, 10, 3, 9) }, "fr");
  expect(real.message.includes("2026") && real.message.includes("novembre"), `the default date is written in words in the lesson language (got ${real.message})`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} study-status assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — study-status (status bar + Reviews node) passed all ${checks} assertions.`);
