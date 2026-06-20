// mcp_class.mjs — run a small CLASS of learners through the lesson-mcp server with telemetry
// CONSENT on, so each learner's pseudonymized ADR-006 stream persists under STUDIUM_DATA_DIR.
// Proves the consented MCP → teacher-analytics pipeline (class_report reads what the MCP host wrote).
//
//   STUDIUM_TELEMETRY_CONSENT=granted node apps/lesson-mcp/mcp_class.mjs
//
// Each learner varies: `misses` = how many of the first quizzes they answer wrong (then pull a
// hint and recover), giving the class report real accuracy/hint-reliance spread.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const TSX = resolve(REPO, "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLES_ROOT = process.env.BUNDLES_ROOT ?? "/tmp/studium_live";
const DATA_DIR = process.env.STUDIUM_DATA_DIR ?? "/tmp/studium_live/data";
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-bundle.zip";

// 6 learners (clears the k=5 floor) with different miss counts → spread of accuracy + hint use.
const CLASS = [
  { id: "amelie", misses: 1 },
  { id: "bruno", misses: 0 },
  { id: "chloe", misses: 2 },
  { id: "diego", misses: 0 },
  { id: "elena", misses: 3 },
  { id: "farid", misses: 1 },
];

async function runLearner(learner) {
  const transport = new StdioClientTransport({
    command: TSX, args: ["src/index.ts"], cwd: HERE,
    env: { ...process.env, BUNDLES_ROOT, STUDIUM_DATA_DIR: DATA_DIR, STUDIUM_TELEMETRY_CONSENT: "granted" },
    stderr: "ignore",
  });
  const client = new Client({ name: "class-sim", version: "0.1.0" });
  await client.connect(transport);
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content?.[0]?.text ?? "{}");
    if (res.isError) throw new Error(`${name}: ${data.error}`);
    return data;
  };

  const started = await call("start_lesson_session", { bundle_ref: BUNDLE_REF, learner_id: `class-${learner.id}` });
  const sid = started.session_id;
  let pres = started.presentation;
  let missesLeft = learner.misses;
  let justMissed = false;
  let steps = 0;

  while (steps++ < 90) {
    const scene = pres.scene;
    let input;
    if (scene.type === "quiz") {
      if (justMissed) { await call("request_hint", { session_id: sid }); justMissed = false; }
      const correct = scene.choices.find((c) => c.correct);
      const wrong = scene.choices.find((c) => !c.correct);
      const answerWrong = missesLeft > 0;
      if (answerWrong) { missesLeft--; justMissed = true; }
      input = { kind: "quiz_choice", choiceId: (answerWrong ? wrong : correct).id };
    } else if (scene.type === "ai_critique") {
      input = { kind: "critique", text: `${scene.claims?.[0]?.id ?? "x"}: FBMN adds MS1 peak-area quantification and retention-time isomer separation.` };
    } else if (scene.type === "meta_checkpoint") {
      input = { kind: "confidence", value: 3 };
    } else {
      input = { kind: "ack" };
    }
    const t = (await call("submit_response", { session_id: sid, input })).transition;
    if (t.kind === "complete") { await client.close(); return { id: learner.id, scenes: t.summary.scenesCompleted, autonomy: t.summary.autonomyRatio }; }
    pres = t.presentation;
  }
  await client.close();
  return { id: learner.id, scenes: "?", autonomy: "?" };
}

async function main() {
  console.log(`Running a class of ${CLASS.length} learners through lesson-mcp (consent ON)…`);
  for (const learner of CLASS) {
    const r = await runLearner(learner);
    console.log(`  ${r.id.padEnd(8)} misses=${learner.misses}  scenes=${r.scenes}  autonomy=${typeof r.autonomy === "number" ? r.autonomy.toFixed(2) : r.autonomy}`);
  }
  console.log(`\nconsented telemetry under ${DATA_DIR} — run class_report next.`);
}
main().catch((e) => { console.error("CLASS ERROR:", e); process.exit(1); });
