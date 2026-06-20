// studium_discuss.mjs — INTERACTIVE narrative free-text discussion over lesson-mcp.
// Fast-forwards (auto-answers) to the discussion scene, then lets the human type free-text
// turns; each turn returns the scored reasoning signal + the Socratic tutor's reply move.
// Deterministic replay (engine + StubReasoningScorer + StubSocraticTutor are LLM-free), so
// each invocation replays the turns given so far and stops awaiting the next.
//
//   node studium_discuss.mjs "my first turn" "my second turn" ... [done]
//   - each quoted arg = one free-text turn;  "done" = end the dialogue and finish the lesson.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = resolve(HERE, "../..", "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-discuss.json";
const turns = process.argv.slice(2);

const out = [];
const p = (s = "") => out.push(s);

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  env: { BUNDLES_ROOT: "/tmp/studium_live", PATH: process.env.PATH,
    // when set, switches the host to LIVE mode → LiteLLM reasoning scorer + Socratic tutor
    ...(process.env.LITELLM_BASE_URL ? { LITELLM_BASE_URL: process.env.LITELLM_BASE_URL } : {}),
    ...(process.env.LITELLM_API_KEY ? { LITELLM_API_KEY: process.env.LITELLM_API_KEY } : {}),
    ...(process.env.STUDIUM_LLM_TIMEOUT_MS ? { STUDIUM_LLM_TIMEOUT_MS: process.env.STUDIUM_LLM_TIMEOUT_MS } : {}),
    ...(process.env.STUDIUM_PSEUDO_SECRET ? { STUDIUM_PSEUDO_SECRET: process.env.STUDIUM_PSEUDO_SECRET } : {}) },
  stderr: "ignore",
});
const client = new Client({ name: "studium-discuss", version: "0.1.0" });
await client.connect(transport);
const call = async (n, a) => {
  const r = await client.callTool({ name: n, arguments: a });
  const d = JSON.parse(r.content?.[0]?.text ?? "{}");
  if (r.isError) throw new Error(`${n}: ${d.error}`);
  return d;
};

const started = await call("start_lesson_session", { bundle_ref: BUNDLE_REF, learner_id: "you" });
const sid = started.session_id;
let pres = started.presentation;

// 1) fast-forward (auto) until we land on the discussion scene
let guard = 0;
while (pres.scene.type !== "discussion" && guard++ < 200) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") input = { kind: "quiz_choice", choiceId: (sc.choices.find((c) => c.correct) ?? sc.choices[0]).id };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: "auto" };
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else input = { kind: "ack" };
  const t = await call("submit_response", { session_id: sid, input });
  if (t.transition.kind === "complete") { p("(reached end of lesson without a discussion scene)"); break; }
  pres = t.transition.presentation;
}

const scene = pres.scene;
if (scene.type === "discussion") {
  p(`💬 DISCUSSION — ${scene.title}`);
  p(`   topic: ${scene.topic}`);
  p(`   seed claim (debate this): "${scene.seed_claim}"`);
  p(`   target reasoning signals: ${scene.target_signals.join(", ")}   ·   max ${scene.max_turns} turns`);
  p("");

  // 2) replay the human's turns; for each, show the scored signal + the tutor's reply
  let finished = false;
  let used = 0;
  for (const turn of turns) {
    if (turn.toLowerCase() === "done") {
      const t = await call("submit_response", { session_id: sid, input: { kind: "ack" } });
      // auto-finish the remaining scenes (critique / checkpoint)
      let tr = t.transition, g = 0;
      while (tr.kind !== "complete" && g++ < 50) {
        const s2 = tr.presentation.scene;
        let inp;
        if (s2.type === "quiz") inp = { kind: "quiz_choice", choiceId: (s2.choices.find((c) => c.correct) ?? s2.choices[0]).id };
        else if (s2.type === "ai_critique") inp = { kind: "critique", text: "auto" };
        else if (s2.type === "meta_checkpoint") inp = { kind: "confidence", value: 3 };
        else inp = { kind: "ack" };
        tr = (await call("submit_response", { session_id: sid, input: inp })).transition;
      }
      p(`✔ Dialogue ended; lesson complete (autonomy ${tr.summary?.autonomyRatio?.toFixed?.(2) ?? "?"}).`);
      finished = true;
      break;
    }
    used++;
    const r = await call("submit_turn", { session_id: sid, text: turn });
    const sig = r.reasoning ? `${r.reasoning.signal} (conf ${r.reasoning.confidence.toFixed(2)})` : "—";
    p(`🧑 you [turn ${used}]: ${turn}`);
    p(`   ↳ reasoning signal scored: ${sig}`);
    if (r.tutor) p(`🎓 tutor [${r.tutor.move_kind}${r.tutor.revealed ? ", reveal-blocked→faded" : ""}]: ${r.tutor.text}`);
    p("");
  }

  if (!finished) {
    const remaining = scene.max_turns - used;
    p(`════════ YOUR TURN — discussion turn ${used + 1}/${scene.max_turns} ════════`);
    p(remaining > 0
      ? `type a free-text reply that argues, gives a counterexample, or synthesizes  ·  or "done" to finish`
      : `(turn cap reached — reply "done" to finish)`);
  }
}

await client.close();
console.log(out.join("\n"));
