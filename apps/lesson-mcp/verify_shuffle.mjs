// verify_shuffle.mjs — prove the answer-position leak is fixed THROUGH the live lesson-mcp
// server: walk the course, and for each quiz report which position/letter now holds the
// correct option. Before the fix every quiz was correct=index0/id "a".
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = resolve(HERE, "../..", "node_modules/.pnpm/node_modules/.bin/tsx");
const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  env: { BUNDLES_ROOT: "/tmp/studium_live", PATH: process.env.PATH }, stderr: "ignore",
});
const client = new Client({ name: "verify-shuffle", version: "0.1.0" });
await client.connect(transport);
const call = async (n, a) => JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);

const started = await call("start_lesson_session", { bundle_ref: "11-enriched.json", learner_id: "verify" });
const sid = started.session_id;
let pres = started.presentation;
const positions = [];
for (let i = 0; i < 120; i++) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") {
    const idx = sc.choices.findIndex((c) => c.correct);
    const correct = sc.choices[idx];
    positions.push({ q: positions.length + 1, letter: correct.id, index: idx });
    input = { kind: "quiz_choice", choiceId: correct.id };
  } else if (sc.type === "ai_critique") input = { kind: "critique", text: "c1: classical MN lacks quantification." };
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else input = { kind: "ack" };
  const t = await call("submit_response", { session_id: sid, input });
  if (t.transition.kind === "complete") break;
  pres = t.transition.presentation;
}
await client.close();

console.log("Per-quiz position of the CORRECT answer (after the load-time shuffle):");
for (const p of positions) console.log(`  Q${String(p.q).padStart(2)}  correct = "${p.letter}"  (index ${p.index})`);
const letters = positions.map((p) => p.letter);
const distinct = [...new Set(letters)];
console.log(`\ndistinct correct-letters used: ${distinct.join(", ")}  (was ONLY "a" before)`);
console.log(letters.every((l) => l === "a") ? "❌ STILL always 'a'" : "✅ correct answer is no longer always 'a' / first");
