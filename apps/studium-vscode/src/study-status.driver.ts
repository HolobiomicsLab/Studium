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

// H3: relearn and unmeasured concepts due for review count too (get_study_plan and start_review_session would play
// them), each labelled with its own words (I-3); and UX-06: they are named by title, never by raw id.
const MIXED = {
  reinforcement: null, due: [], reason: "nothing_due", next_due_at: 1_800_000_000_000,
  relearn: [{ ...target("concept:generalite-collectif"), concept_title: "Généralité du collectif" }],
  unmeasured: [target("c3"), target("c4")],
};
{
  const s = parseReinforcement(MIXED, (id) => (id === "c3" ? "Troisième notion" : undefined));
  expect(s.dueCount === 3 && s.hasHistory, `relearn and unmeasured items are counted as due for review (got ${s.dueCount})`);
  expect(JSON.stringify(s.counts) === '{"due":0,"relearn":1,"unmeasured":2}', `each group keeps its own count (got ${JSON.stringify(s.counts)})`);
  // H3 / I-3: the status bar never announces an unmeasured concept as a review of something learnt. Changed: this
  // used to expect « Studium · 3 à réviser » for one relearn and two unmeasured concepts (the finding).
  expect(statusBarText(s, "fr")?.text === "Studium · 3 à travailler", `a mixed status bar is worded neutrally (got ${statusBarText(s, "fr")?.text})`);
  expect(statusBarText(s, "en")?.text === "Studium · 3 to work on", `in English too (got ${statusBarText(s, "en")?.text})`);
  expect(statusBarText(s, "fr")?.tooltip === "1 notion à reprendre, 2 notions pas encore mesurées. Ouvre le panneau Studium.",
    `the tooltip names each group in its own words (got ${statusBarText(s, "fr")?.tooltip})`);
  expect(statusBarText(s, "en")?.tooltip === "1 concept to take up again, 2 concepts not measured yet. Open the Studium panel.",
    `the English tooltip too (got ${statusBarText(s, "en")?.tooltip})`);
  const all = parseReinforcement({ ...MIXED, due: [target("c5"), target("c6")] });
  expect(statusBarText(all, "fr")?.tooltip === "2 notions à réviser, 1 notion à reprendre, 2 notions pas encore mesurées. Ouvre le panneau Studium.",
    `all three groups, due first (got ${statusBarText(all, "fr")?.tooltip})`);
  const node = reviewsNode(s, "fr", (ms) => `D${ms}`)!;
  const labels = (node.children ?? []).map((c) => `${c.label}|${c.description ?? ""}`);
  expect(JSON.stringify(labels) === JSON.stringify([
    `Généralité du collectif|${hostPhrase("reviews_group_relearn", {}, "fr")}`,
    `Troisième notion|${hostPhrase("reviews_group_unmeasured", {}, "fr")}`,
    `c4|${hostPhrase("reviews_group_unmeasured", {}, "fr")}`,
  ]), `concepts are named by the host's title, else the lesson's, else the id without its prefix, with their group (got ${JSON.stringify(labels)})`);
  expect(!labels.some((l) => l.includes("concept:")), "never a raw concept: id");
  const one = parseReinforcement({ ...MIXED, unmeasured: [] });
  // Changed: the one-item tooltip is now the relearn group's own wording (it was the generic « 1 notion à réviser »).
  expect(statusBarText(one, "fr")?.tooltip === "1 notion à reprendre. Ouvre le panneau Studium." && !statusBarText(one, "fr")!.tooltip.includes("(s)"),
    `one item reads in the singular, never « notion(s) » (got ${statusBarText(one, "fr")?.tooltip})`);
  // Changed: the plural is now per group (« 2 notions pas encore mesurées »), no longer one total « 3 notions ».
  expect(!statusBarText(s, "fr")!.tooltip.includes("(s)") && statusBarText(s, "fr")!.tooltip.includes("2 notions"), "several read in the plural");
  // An older server sends only `due`: unchanged behaviour.
  expect(JSON.stringify(parseReinforcement(DUE).counts) === '{"due":3,"relearn":0,"unmeasured":0}', "an older payload counts its due list alone");
}

// statusBarText: shown only when something is due
{
  const s = parseReinforcement(DUE);
  expect(statusBarText(s, "fr")?.text === "Studium · 3 à réviser", "French status bar text");
  expect(statusBarText(s, "en")?.text === "Studium · 3 to review", "English status bar text");
  expect(!!statusBarText(s, "en")?.tooltip.includes("3"), "the tooltip carries the count");
  expect(statusBarText(s, "fr")?.tooltip === "3 notions à réviser. Ouvre le panneau Studium.", `only due items: « à réviser » (got ${statusBarText(s, "fr")?.tooltip})`);
  expect(statusBarText(parseReinforcement({ reason: "due", due: [target("c1")] }), "fr")?.tooltip === "1 notion à réviser. Ouvre le panneau Studium.",
    "one due item reads in the singular");
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
