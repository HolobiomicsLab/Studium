// pane-messages.driver.ts — what the extension host accepts from the lesson pane's rateRecall message
// (C4: the learner's self-rating of a recall). No VS Code APIs.
//   node_modules/.pnpm/node_modules/.bin/tsx apps/studium-vscode/src/pane-messages.driver.ts
import { parseRateRecall } from "./pane-messages.js";

const failures: string[] = [];
let checks = 0;
function expect(cond: boolean, msg: string) { checks++; if (!cond) failures.push(msg); }

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

if (failures.length) {
  console.error(`FAIL — ${failures.length}/${checks} pane-messages assertions failed:`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — pane-messages (rateRecall validation) passed all ${checks} assertions.`);
