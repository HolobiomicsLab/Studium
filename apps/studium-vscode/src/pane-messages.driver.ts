// pane-messages.driver.ts — what the extension host accepts from the lesson pane's rateRecall message
// (C4: the learner's self-rating of a recall). No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/pane-messages.driver.ts
import { assetBundleRef, parseRateRecall, reviewContext } from "./pane-messages.js";
import { sessionLostReason } from "./session-lost.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

// Walkthrough 2026-11-07: the tool error the extension forwards to the pane when the server lost the session. The
// MCP client prefixes it with the tool's name (mcp-connect.ts parseToolResult); only « session not found » is matched.
{
  const reason = "session not found: sid-42 (the server may have restarted, or the session was closed): call start_lesson_session";
  expect(sessionLostReason(new Error(`panel_action: ${reason}`)) === reason, "a lost session behind the tool's name is recognised, its reason kept");
  expect(sessionLostReason(new Error(reason)) === reason, "and without the tool's name");
  expect(sessionLostReason(new Error("panel_action: request timed out")) === null, "another tool error is not a lost session");
  expect(sessionLostReason(new Error("panel_action: the scene says session not found")) === null, "the words elsewhere in the message do not count");
  expect(sessionLostReason("nope") === null && sessionLostReason(undefined) === null, "a non-error is not a lost session");
}

for (const grade of ["again", "hard", "good", "easy"]) {
  const r = parseRateRecall({ type: "rateRecall", sceneId: "s3", grade });
  expect(!!r && r.sceneId === "s3" && r.grade === grade, `grade ${grade} is accepted`);
}
expect(parseRateRecall({ type: "rateRecall", sceneId: "s3", grade: "perfect" }) === null, "an unknown grade is refused");
expect(parseRateRecall({ type: "rateRecall", sceneId: "s3", grade: 3 }) === null, "a numeric grade is refused");
expect(parseRateRecall({ type: "rateRecall", grade: "good" }) === null, "a missing sceneId is refused");
expect(parseRateRecall({ type: "rateRecall", sceneId: "", grade: "good" }) === null, "an empty sceneId is refused");
expect(parseRateRecall({ type: "rateRecall", sceneId: 7, grade: "good" }) === null, "a non-string sceneId is refused");
expect(parseRateRecall(null) === null && parseRateRecall(undefined) === null, "a non-object message is refused");

// UX-03: a review session names its concepts and the lesson each scene comes from.
{
  const reply = { status: "started", review: { items: [
    { concept_id: "c-a", concept: "Notion A", lesson_title: "Leçon 1", scene_id: "r1", bundle_ref: "lecon-1/lesson.json" },
    { concept_id: "c-b", concept: "", lesson_title: "Leçon 2", scene_id: "r2" },
    { concept_id: 3, concept: "x" }, null,
  ] } };
  const ctx = reviewContext(reply);
  expect(JSON.stringify(ctx.titles) === '{"c-a":"Notion A"}', `review titles by concept id (got ${JSON.stringify(ctx.titles)})`);
  expect(JSON.stringify(ctx.origins) === '{"r1":"lecon-1/lesson.json"}', "scene origins when the host names them");
  expect(assetBundleRef({}, "r1", ctx, "ouverte/lesson.json") === "lecon-1/lesson.json", "a review scene's asset resolves against its own lesson");
  expect(assetBundleRef({ bundle_ref: "autre/lesson.json" }, "r1", ctx, "ouverte/lesson.json") === "autre/lesson.json", "the asset's own bundle_ref wins");
  expect(assetBundleRef({}, "r2", ctx, "ouverte/lesson.json") === "ouverte/lesson.json" && assetBundleRef({}, "x", null, "o") === "o",
    "without an origin, the opened lesson");
  expect(JSON.stringify(reviewContext(null)) === '{"titles":{},"origins":{}}', "no review data, empty context");
}

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} pane-messages assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — pane-messages (rateRecall validation) passed all ${checks} assertions.`);
