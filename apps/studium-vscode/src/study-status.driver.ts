// study-status.driver.ts — VSC-6: the "n à réviser" status-bar text and the Reviews tree node, fed by the
// result of get_next_reinforcement. No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/study-status.driver.ts
import { minutesLeft, parseReinforcement, parseStudyProgress, statusBarText, reviewsNode, reviewStartReply } from "./study-status.js";
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

// INT-STUDIUM-058, task 2.6: while a lesson plays, the status bar shows the lesson's status line (the
// view's status_line); what is due stays in the tooltip. It returns to the review count when the lesson closes.
{
  const line = "Les atomes · étape 2/3 · 3 min · à toi de répondre";
  const playing = statusBarText(parseReinforcement(DUE), "fr", line);
  expect(playing?.text === line, `a lesson being played shows its status line (got ${playing?.text})`);
  expect(playing?.tooltip === "3 notions à réviser. Ouvre le panneau Studium.", `the tooltip keeps what is due (got ${playing?.tooltip})`);
  const nothingDue = statusBarText(parseReinforcement(FRESH), "fr", line);
  expect(nothingDue?.text === line, "the line shows even when nothing is due");
  expect(nothingDue?.tooltip === "Leçon en cours. Ouvre le panneau Studium.", `with its own tooltip (got ${nothingDue?.tooltip})`);
  expect(statusBarText(null, "en", line)?.tooltip === "Lesson in progress. Open the Studium panel.", "in English too");
  expect(statusBarText(parseReinforcement(DUE), "fr", null)?.text === "Studium · 3 à réviser", "no lesson: the review count, as before");
  expect(statusBarText(parseReinforcement(DUE), "fr", "  ")?.text === "Studium · 3 à réviser", "a blank line is no line");
  expect(statusBarText(null, "fr", "a\nb\u001b[31m c")?.text === "a b [31m c", `one line, no control character (got ${statusBarText(null, "fr", "a\nb\u001b[31m c")?.text})`);
}

// BN-4: while the assistant prepares a lesson (prepare_sources wrote its source set, the lesson is not there yet), the
// bar shows a spinner and says so, ahead of the review count, which moves to the tooltip. The tooltip names the source,
// says it takes a few minutes, and says to answer the assistant in the chat if it asks to allow a step. A lesson being
// played keeps the bar.
{
  const preparing = { title: "La photosynthèse : notes de cours (L1)" };
  const idle = statusBarText(null, "en", null, preparing);
  expect(idle?.text === hostPhrase("status_preparing", {}, "en") && idle.text.startsWith("$(loading~spin) "),
    `nothing due + preparing: a spinner and the preparing text (got ${idle?.text})`);
  expect(!!idle?.tooltip.includes("“La photosynthèse : notes de cours (L1)”"), `the tooltip names the source (got ${idle?.tooltip})`);
  expect(!!idle && /few minutes/.test(idle.tooltip) && /chat/.test(idle.tooltip) && /allow/i.test(idle.tooltip),
    `it says how long, and to allow a step in the chat if asked (got ${idle?.tooltip})`);
  const fr = statusBarText(parseReinforcement(FRESH), "fr", null, preparing);
  expect(fr?.text === hostPhrase("status_preparing", {}, "fr") && !!fr?.tooltip.includes("quelques minutes") && !!fr?.tooltip.includes("chat"),
    `in French too (got ${JSON.stringify(fr)})`);
  const due = statusBarText(parseReinforcement(DUE), "fr", null, preparing);
  expect(due?.text === hostPhrase("status_preparing", {}, "fr"), `preparing outranks the review count while it lasts (got ${due?.text})`);
  expect(!!due?.tooltip.includes("3 notions à réviser"), `the review count moves to the tooltip (got ${due?.tooltip})`);
  const line = "Les atomes · étape 2/3 · 3 min · à toi de répondre";
  expect(statusBarText(parseReinforcement(DUE), "fr", line, preparing)?.text === line, "a lesson being played keeps the bar");
  expect(statusBarText(parseReinforcement(DUE), "fr", null, null)?.text === "Studium · 3 à réviser", "nothing prepared: the review count, as before");
  const untitled = statusBarText(null, "en", null, { title: "" });
  expect(untitled?.text === hostPhrase("status_preparing", {}, "en") && !untitled.tooltip.includes("“”"), `a source without a title is not quoted empty (got ${untitled?.tooltip})`);
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
  expect(buildLessonTree({ courses: [{ ref: "a/lesson.json", title: "A", target: "L1", language: "fr", approval: { state: "none" } }], community: [], onReproductionScene: false, emptyAsWelcome: true }).length > 0, "a discovered course keeps the tree");
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

// BN-7: « Continue » and each lesson's progress, from get_study_plan and list_lessons. The payloads are what a real
// server sent (apps/studium-vscode/dist/lesson-mcp.cjs, learner vscode-learner, after 3 steps of the English demo);
// only the fields read here are kept.
const DEMO_EN = "discover-studium-en/lesson.json";
const PLAN_3 = {
  in_progress: [{ bundle_ref: DEMO_EN, title: "Discover Studium", scenes_completed: 3, total_scenes: 12 }],
  next_step: { action: "continue", arguments: { bundle_ref: DEMO_EN, learner_id: "vscode-learner" } },
};
const LIST_3 = {
  lessons: [],
  shipped_lessons: [
    { bundle_ref: DEMO_EN, title: "Discover Studium", language: "en", source: "shipped", scene_count: 12,
      status: { state: "in_progress", scenes_completed: 3, total_scenes: 12 } },
    { bundle_ref: "discover-studium-fr/lesson.json", title: "Découvrir Studium", language: "fr", source: "shipped", scene_count: 12,
      status: { state: "new", scenes_completed: 0, total_scenes: 12 } },
  ],
};
{
  const p = parseStudyProgress(PLAN_3, LIST_3, (ref, source) => (ref === DEMO_EN && source === "shipped" ? 10 : undefined));
  const c = p.continueWith;
  expect(c?.ref === DEMO_EN && c.source === "shipped" && c.title === "Discover Studium" && c.done === 3 && c.total === 12,
    `Continue is in_progress[0], opened from the root list_lessons gives (got ${JSON.stringify(c)})`);
  expect(c?.minutesLeft === 8, `minutes left = ceil(duration × remaining / total) = ceil(10 × 9 / 12) (got ${c?.minutesLeft})`);
  expect(JSON.stringify(p.lessons[`shipped:${DEMO_EN}`]) === '{"state":"in_progress","done":3,"total":12}',
    `each listed lesson's progress is kept by root and ref (got ${JSON.stringify(p.lessons)})`);
  expect(!p.lessons["shipped:discover-studium-fr/lesson.json"], "a lesson not started has no progress");
  const unknown = parseStudyProgress(PLAN_3, LIST_3);
  expect(unknown.continueWith?.ref === DEMO_EN && unknown.continueWith.minutesLeft === null, "no duration: the minutes are left out");
  // A server answer after the 12 steps of the demo, before the end screen: 12/12 is still in progress; nothing to continue.
  const allDone = parseStudyProgress({ in_progress: [{ ...PLAN_3.in_progress[0], scenes_completed: 12 }] },
    { lessons: [], shipped_lessons: [{ ...LIST_3.shipped_lessons[0], status: { state: "in_progress", scenes_completed: 12, total_scenes: 12 } }] });
  expect(allDone.continueWith === null, `a lesson whose steps are all done is not offered to continue (got ${JSON.stringify(allDone.continueWith)})`);
  // in_progress is newest first; a ref list_lessons does not list (a community bundle, a deleted lesson) is skipped.
  const mine = { bundle_ref: "photosynthese/lesson.json", title: "La photosynthèse", language: "fr", source: "library", scene_count: 9,
    status: { state: "in_progress", scenes_completed: 6, total_scenes: 9 } };
  const two = parseStudyProgress(
    { in_progress: [{ bundle_ref: "wave/community/community-item1.zip", title: "Gone", scenes_completed: 1, total_scenes: 4 },
      { bundle_ref: mine.bundle_ref, title: mine.title, scenes_completed: 6, total_scenes: 9 }, PLAN_3.in_progress[0]] },
    { lessons: [mine], shipped_lessons: LIST_3.shipped_lessons }, () => 15);
  expect(two.continueWith?.ref === mine.bundle_ref && two.continueWith.source === "library" && two.continueWith.minutesLeft === 5,
    `the newest listed lesson is offered, from its own root (got ${JSON.stringify(two.continueWith)})`);
  const done = parseStudyProgress({ in_progress: [] }, { lessons: [{ ...mine, status: { state: "completed", scenes_completed: 9, total_scenes: 9 } }] });
  expect(done.continueWith === null && done.lessons["library:photosynthese/lesson.json"]?.state === "completed", "a completed lesson is kept as done");
  for (const junk of [null, {}, { in_progress: "x" }, { in_progress: [{ bundle_ref: 3 }] }]) {
    const j = parseStudyProgress(junk, junk);
    expect(j.continueWith === null && Object.keys(j.lessons).length === 0, `an unrecognised payload gives no progress, never a throw (${JSON.stringify(junk)})`);
  }
  expect(minutesLeft(15, 6, 9) === 5 && minutesLeft(10, 11, 12) === 1 && minutesLeft(undefined, 3, 12) === null
    && minutesLeft(0, 3, 12) === null && minutesLeft(10, 12, 12) === null, "minutesLeft: rounded up, at least 1, null when unknown or done");
}

// BN-7: the bar says « continue <lesson> » only when nothing is due, nothing is being prepared and no lesson plays (the
// rule « no news is not shown » gives way to this one piece of news). Clicking it resumes the lesson (resume).
{
  const cont = { title: "Discover Studium", done: 3, total: 12, minutesLeft: 8 };
  const idle = statusBarText(null, "en", null, null, cont);
  expect(idle?.text === hostPhrase("status_continue", { title: "Discover Studium" }, "en") && idle.resume === true,
    `nothing due: the bar offers to continue the lesson (got ${JSON.stringify(idle)})`);
  expect(!!idle?.tooltip.includes(hostPhrase("status_tooltip_continue", { title: "Discover Studium", step: 4, total: 12 }, "en"))
    && idle.tooltip.includes(hostPhrase("continue_minutes_left", { minutes: 8 }, "en")) && idle.tooltip.includes(hostPhrase("continue_scope", {}, "en")),
    `its tooltip gives the step, the minutes left and whose progress this is (got ${idle?.tooltip})`);
  const later = statusBarText(parseReinforcement(LATER), "fr", null, null, cont);
  expect(later?.text === hostPhrase("status_continue", { title: "Discover Studium" }, "fr"), `nothing due yet: continue, in French too (got ${later?.text})`);
  expect(statusBarText(parseReinforcement(DUE), "fr", null, null, cont)?.text === "Studium · 3 à réviser", "a due review keeps the bar");
  expect(statusBarText(null, "en", null, { title: "x" }, cont)?.text === hostPhrase("status_preparing", {}, "en"), "a lesson being prepared keeps the bar");
  expect(statusBarText(null, "en", "Lesson · step 2/3", null, cont)?.text === "Lesson · step 2/3", "a lesson being played keeps the bar");
  expect(statusBarText(parseReinforcement(LATER), "en", null, null, null) === null, "nothing to continue: no news is still not shown");
  const long = statusBarText(null, "en", null, null, { ...cont, title: "A".repeat(80), minutesLeft: null });
  expect(!!long && long.text.length < 70 && long.text.includes("…") && long.tooltip.includes("A".repeat(80))
    && !/About \d+ min/.test(long.tooltip),
    `a long title is shortened in the bar, whole in the tooltip, and unknown minutes are left out (got ${JSON.stringify(long)})`);
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} study-status assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — study-status (status bar + Reviews node) passed all ${checks} assertions.`);
