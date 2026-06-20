// student_demo.mjs — drive a LIVE Studium student session through the lesson-mcp server,
// exactly as a VS Code Copilot (or any MCP client) would: spawn the stdio MCP server and
// call its tools. Simulates a student ("Amélie") working through a course authored from a
// real research article, including one wrong answer to trigger the adaptive loop.
//
//   node apps/lesson-mcp/student_demo.mjs
//
// Env: BUNDLE_REF (default 11-bundle.zip), BUNDLES_ROOT (default /tmp/studium_live),
//      STUDIUM_DATA_DIR (default /tmp/studium_live/data) so events/state/mastery persist.

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

const C = { dim: "\x1b[2m", b: "\x1b[1m", grn: "\x1b[32m", red: "\x1b[31m", ylw: "\x1b[33m", cyn: "\x1b[36m", mag: "\x1b[35m", r: "\x1b[0m" };
const log = (...a) => console.log(...a);
const rule = (s) => log(`\n${C.dim}${"─".repeat(78)}${C.r}${s ? "\n" + s : ""}`);

async function main() {
  // 1) Spawn the lesson-mcp server over stdio (this IS what VS Code Copilot connects to).
  const transport = new StdioClientTransport({
    command: TSX,
    args: ["src/index.ts"],
    cwd: HERE,
    env: { ...process.env, BUNDLES_ROOT, STUDIUM_DATA_DIR: DATA_DIR },
    stderr: "inherit",
  });
  const client = new Client({ name: "vscode-copilot-sim", version: "0.1.0" });
  await client.connect(transport);

  const tools = (await client.listTools()).tools.map((t) => t.name);
  rule(`${C.b}lesson-mcp connected${C.r}  (the MCP server VS Code Copilot drives)`);
  log(`${C.dim}tools exposed:${C.r} ${tools.join(", ")}`);

  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    const txt = res.content?.[0]?.text ?? "{}";
    const data = JSON.parse(txt);
    if (res.isError) throw new Error(`${name} failed: ${data.error}`);
    return data;
  };

  const masteryLine = (snap) => {
    const m = snap?.conceptMastery ?? {};
    const parts = Object.entries(m).map(([k, v]) => `${k.replace(/^concept:/, "").slice(0, 22)}=${(v).toFixed(2)}`);
    return parts.length ? parts.join("  ") : "(no mastery yet)";
  };

  // 2) Start the session.
  rule(`${C.b}▶ Amélie starts the course${C.r}`);
  const started = await call("start_lesson_session", { bundle_ref: BUNDLE_REF, learner_id: "student-amelie" });
  const sid = started.session_id;
  log(`${C.dim}session ${sid.slice(0, 8)}…  bundle ${BUNDLE_REF}${C.r}`);

  let pres = started.presentation;
  let mistakesLeft = 1;          // get exactly one quiz wrong to show the adaptive loop
  let justMissed = false;
  let firstQuizSeen = false;
  const seenScenes = new Set();
  let steps = 0;

  while (steps++ < 80) {
    const scene = pres.scene;
    const n = `${pres.index + 1}/${pres.total}`;
    const type = scene.type;

    let input;
    if (type === "intro" || type === "concept") {
      const head = (scene.markdown || "").split("\n").find((l) => l.trim()) || "";
      log(`\n${C.cyn}[${n}] ${type}${C.r} — ${scene.title}`);
      log(`${C.dim}   ${head.slice(0, 110)}${head.length > 110 ? "…" : ""}${C.r}`);
      log(`   ${C.dim}Amélie reads, then continues ▸${C.r}`);
      input = { kind: "ack" };
    } else if (type === "quiz") {
      const correct = scene.choices.find((c) => c.correct);
      const wrong = scene.choices.find((c) => !c.correct);
      log(`\n${C.ylw}[${n}] quiz${C.r} — ${scene.question}`);
      for (const c of scene.choices) log(`      ${c.id}) ${c.text}`);
      // if she just missed a question, explicitly PULL a hint via the request_hint MCP tool
      // (emits hint_requested + applies the M5 mastery discount on the next answer)
      if (justMissed) {
        const h = await call("request_hint", { session_id: sid });
        if (h.hint?.hint) log(`   ${C.mag}💡 request_hint →${C.r} ${h.hint.hint} ${C.dim}(${h.hint.remaining} left)${C.r}`);
        justMissed = false;
      }
      const answerWrong = mistakesLeft > 0 && !firstQuizSeen;
      firstQuizSeen = true;
      const pick = answerWrong ? wrong : correct;
      if (answerWrong) { mistakesLeft--; justMissed = true; }
      log(`   ${answerWrong ? C.red + "✗ Amélie answers" : C.grn + "✓ Amélie answers"} ${pick.id}) "${pick.text.slice(0, 60)}"${C.r}`);
      input = { kind: "quiz_choice", choiceId: pick.id };
    } else if (type === "ai_critique") {
      log(`\n${C.cyn}[${n}] ai_critique${C.r} — Amélie critiques a planted claim`);
      const claim = scene.claims?.[0];
      const txt = claim ? `${claim.id}: this conflates spectral count with abundance; FBMN integrates MS1 peak area for quantification, and retention time separates isomers.` : "critique";
      log(`   ${C.dim}claim: ${(claim?.text || "").slice(0, 90)}${C.r}`);
      input = { kind: "critique", text: txt };
    } else if (type === "meta_checkpoint") {
      log(`\n${C.cyn}[${n}] meta_checkpoint${C.r} — ${scene.post_question || scene.pre_question}`);
      log(`   ${C.dim}Amélie rates her confidence: 3/4${C.r}`);
      input = { kind: "confidence", value: 3 };
    } else {
      input = { kind: "ack" };
    }

    const t = await call("submit_response", { session_id: sid, input });
    const tr = t.transition;

    if (tr.kind === "complete") {
      rule(`${C.grn}${C.b}✔ Lesson complete${C.r}`);
      const s = tr.summary;
      log(`   scenes completed : ${s.scenesCompleted}`);
      log(`   autonomy ratio   : ${C.b}${s.autonomyRatio.toFixed(2)}${C.r}  ${C.dim}(1.0 = no scaffolding leaned on; lower = engine helped)${C.r}`);
      if (tr.calibration) log(`   calibration check: concept ${tr.calibration.targetConcept}`);
      break;
    }

    // Narrate adaptation when the engine did something other than a plain advance.
    const snap = tr.presentation?.learnerSnapshot;
    if (tr.kind === "replay" || tr.kind === "remediate_alt") {
      log(`   ${C.red}↻ engine: ${tr.kind}${C.r} ${C.dim}(${tr.reason})${C.r}`);
      const ex = await call("explain_last_adaptation", { session_id: sid });
      if (ex.explanation) log(`   ${C.mag}why:${C.r} ${ex.explanation.rule_id} → ${ex.explanation.explanation_short} ${C.dim}[${ex.explanation.modulator}]${C.r}`);
    } else if (tr.kind === "calibration") {
      log(`   ${C.mag}⟳ calibration panel${C.r} for ${tr.targetConcept}`);
    } else if (pres.explanation || tr.presentation?.explanation) {
      const e = tr.presentation?.explanation;
      if (e) log(`   ${C.mag}adapt:${C.r} ${e.rule_id} → ${e.explanation_short} ${C.dim}[${e.modulator}]${C.r}`);
    }
    if (snap) log(`   ${C.dim}mastery: ${masteryLine(snap)}${C.r}`);

    pres = tr.presentation;
  }

  // 3) The learner's own state (stays local on her device — RGPD).
  rule(`${C.b}Amélie's final learner state${C.r} ${C.dim}(local-only — never leaves her device)${C.r}`);
  const st = await call("get_session_state", { session_id: sid });
  const cs = st.state?.concept_states ?? {};
  for (const [cid, s] of Object.entries(cs)) {
    const a = s.alpha ?? s.mastery_alpha, b = s.beta ?? s.mastery_beta;
    const mastery = (typeof a === "number" && typeof b === "number") ? a / (a + b) : (s.mastery ?? "?");
    log(`   ${cid.replace(/^concept:/, "")}  mastery≈${typeof mastery === "number" ? mastery.toFixed(2) : mastery}  ${C.dim}(α=${a}, β=${b}, attempts=${s.attempts ?? "?"})${C.r}`);
  }

  await client.close();
  log(`\n${C.dim}(session kept — telemetry/state persisted under ${DATA_DIR} for the teacher view; not forgotten)${C.r}`);
}

main().catch((e) => { console.error("DEMO ERROR:", e); process.exit(1); });
