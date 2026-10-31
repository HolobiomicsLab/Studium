// completion.driver.ts — L-6: the end-of-lesson lists. The host's split is read when it is sent; the fallback
// applies the host's rule, whose two constants are pinned against the host packages' sources here.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/completion.driver.ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { completionSplit, lessonNextReviewAfterRating, MIN_MASTERY_ATTEMPTS, REVIEW_MIN_MASTERY } from "./completion.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = (rel: string) => readFileSync(resolve(repo, rel), "utf8");
const constant = (text: string, name: string) => Number(new RegExp(`export const ${name}\\s*=\\s*([0-9.]+)`).exec(text)?.[1]);
expect(constant(source("packages/lesson-session/src/graph-nav.ts"), "MIN_MASTERY_ATTEMPTS") === MIN_MASTERY_ATTEMPTS,
  "MIN_MASTERY_ATTEMPTS mirrors packages/lesson-session/src/graph-nav.ts");
expect(constant(source("packages/lesson-session-host/src/study-plan.ts"), "REVIEW_MIN_MASTERY") === REVIEW_MIN_MASTERY,
  "REVIEW_MIN_MASTERY mirrors packages/lesson-session-host/src/study-plan.ts");

// The fallback rule (an older host): one right answer is practised, never consolidated; three graded answers at or
// above the threshold are consolidated; a concept without a graded answer, or with null mastery, is not measured.
{
  const t = { kind: "complete", summary: {
    mastery: { once: 0.9, thrice: 0.85, weak: 0.3, rated: 0.5, unknown: null },
    finalState: { concept_states: { once: { total_attempts: 1 }, thrice: { total_attempts: 3 }, weak: { total_attempts: 4 }, rated: { total_attempts: 0 } } },
  } };
  const s = completionSplit(t);
  expect(JSON.stringify(s.consolidated) === '["thrice"]', `only the concept past the floor and the threshold is consolidated (got ${JSON.stringify(s.consolidated)})`);
  expect(JSON.stringify(s.practised) === '[{"id":"once","answers":1},{"id":"weak","answers":4}]', `graded concepts below it are practised with their count (got ${JSON.stringify(s.practised)})`);
  expect(JSON.stringify(s.not_measured) === '["rated","unknown"]', `unmeasured concepts are named as such (got ${JSON.stringify(s.not_measured)})`);
}
// The host's split wins when sent, whatever the summary says.
{
  const t = { kind: "complete", completion: { consolidated: ["a"], practised: [{ concept_id: "b", answers: 2 }, "c"], not_measured: [{ concept_id: "d" }] },
    summary: { mastery: { a: 0.1, b: 0.9, c: 0.9, d: 0.9 }, finalState: { concept_states: { c: { total_attempts: 5 } } } } };
  const s = completionSplit(t);
  expect(JSON.stringify(s) === '{"consolidated":["a"],"practised":[{"id":"b","answers":2},{"id":"c","answers":5}],"not_measured":["d"]}',
    `the host's split is read as sent (got ${JSON.stringify(s)})`);
  expect(JSON.stringify(completionSplit({ summary: { completion: { consolidated: [], practised: [], not_measured: ["x"] } } }).not_measured) === '["x"]',
    "it may ride on the summary too");
}
expect(JSON.stringify(completionSplit({})) === '{"consolidated":[],"practised":[],"not_measured":[]}', "an empty transition gives empty lists");

// UX-11: after a rating on the last scene, the end screen's next review stays THIS lesson's earliest review
// (review_plan: the lesson's concepts, earliest first), never the cross-lesson reinforcement date.
{
  const plan = { next_due_at: 1000, concepts: ["c1", "c2"] };
  // The host's own updated plan wins when rate_recall sends one.
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c1", next_review_at: 5000, review_plan: { next_due_at: 1200, concepts: ["c2", "c1"] } }) === 1200,
    "the review_plan rate_recall sends is read as is");
  // The rated concept was not the earliest: the lesson's earliest is the sooner of the two.
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c2", next_review_at: 5000 }) === 1000, "a later rating of another concept keeps the earliest");
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c2", next_review_at: 500 }) === 500, "a sooner one becomes the earliest");
  // The earliest concept was rated sooner than before: still the earliest (the others were due no sooner).
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c1", next_review_at: 800 }) === 800, "the rated earliest concept, sooner, stays earliest");
  // The earliest concept moved later and others remain: their dates are unknown, so the screen keeps its date.
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c1", next_review_at: 5000 }) === undefined,
    "unknown: the end screen keeps the date it shows rather than a single concept's");
  // Every concept of the lesson was rated (L-9 concept_ids): the rating's date is the lesson's.
  expect(lessonNextReviewAfterRating(plan, { concept_ids: ["c1", "c2"], next_review_at: 5000 }) === 5000, "all rated: the rating's date");
  expect(lessonNextReviewAfterRating({ next_due_at: 1000, concepts: ["c1"] }, { concept_id: "c1", next_review_at: 5000 }) === 5000,
    "a one-concept lesson takes the rating's date");
  // No plan yet (nothing reviewed before): the rated concept is the lesson's only review.
  expect(lessonNextReviewAfterRating(undefined, { concept_id: "c1", next_review_at: 5000 }) === 5000, "no previous plan: the rating's date");
  expect(lessonNextReviewAfterRating({ next_due_at: null, concepts: [] }, { concept_id: "c1", next_review_at: 5000 }) === 5000, "an empty plan too");
  expect(lessonNextReviewAfterRating(plan, { concept_id: "c1" }) === undefined, "a rating without a date changes nothing");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} completion assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — completion (L-6 split, host rule mirrored) passed all ${checks} assertions.`);
