// studium_meta.mjs — INTERACTIVE meta_checkpoint (confidence calibration) over lesson-mcp.
// Fast-forwards (answering quizzes correctly) to the meta_checkpoint, shows the self-assessment
// question + scale, takes your declared confidence (0-4), then reports the calibration gap:
// your DECLARED confidence vs your ACTUAL measured mastery on the target concept.
//
//   node studium_meta.mjs        # show the question + scale
//   node studium_meta.mjs 1      # declare confidence 0..4 → see calibration

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = resolve(HERE, "../..", "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-enriched.json";
const arg = process.argv[2];
const confidence = arg === undefined ? null : Math.max(0, Math.min(4, parseInt(arg, 10)));

const out = [];
const p = (s = "") => out.push(s);

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  env: { BUNDLES_ROOT: "/tmp/studium_live", PATH: process.env.PATH, STUDIUM_EPHEMERAL: "1" }, stderr: "ignore", // I-10: in memory
});
const client = new Client({ name: "studium-meta", version: "0.1.0" });
await client.connect(transport);
const call = async (n, a) => {
  const r = await client.callTool({ name: n, arguments: a });
  const d = JSON.parse(r.content?.[0]?.text ?? "{}");
  if (r.isError) throw new Error(`${n}: ${d.error}`);
  return d;
};
const masteryOf = (st, cid) => {
  const c = (st.state?.concept_states ?? {})[cid];
  if (!c) return null;
  const a = c.alpha ?? c.mastery_alpha, b = c.beta ?? c.mastery_beta;
  return (typeof a === "number" && typeof b === "number") ? a / (a + b) : (c.mastery ?? null);
};

const started = await call("start_lesson_session", { bundle_ref: BUNDLE_REF, learner_id: "you" });
const sid = started.session_id;
let pres = started.presentation;

// fast-forward (answer quizzes correctly) to the meta_checkpoint scene
let guard = 0;
while (pres.scene.type !== "meta_checkpoint" && guard++ < 200) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") input = { kind: "quiz_choice", choiceId: (sc.choices.find((c) => c.correct) ?? sc.choices[0]).id };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: "auto" };
  else input = { kind: "ack" };
  const t = await call("submit_response", { session_id: sid, input });
  if (t.transition.kind === "complete") { p("(reached end without a meta_checkpoint scene)"); break; }
  pres = t.transition.presentation;
}

const scene = pres.scene;
if (scene.type === "meta_checkpoint") {
  const labels = scene.scale_labels ?? [];
  const targetConcept = (scene.concept_refs ?? [])[0];
  p(`🔎 META-CHECKPOINT — ${scene.title}`);
  p(`   ${scene.pre_question}`);
  p(`   scale: ${labels.map((l, i) => `${i}=${l}`).join("  ·  ")}`);

  if (confidence === null) {
    p("");
    p(`════════ YOUR TURN ════════`);
    p(`reply with a number 0–4 for how confident you feel.`);
  } else {
    // mastery BEFORE the checkpoint (what you actually demonstrated)
    const before = await call("get_session_state", { session_id: sid });
    const t = await call("submit_response", { session_id: sid, input: { kind: "confidence", value: confidence } });
    const tr = t.transition;
    const after = await call("get_session_state", { session_id: sid });
    const cid = (tr.calibration?.targetConcept) || targetConcept;
    const mastery = masteryOf(after, cid) ?? masteryOf(before, cid);
    const declaredNorm = confidence / 4;
    p("");
    p(`🧑 you declared: ${confidence}/4  (${labels[confidence] ?? ""})  → ${(declaredNorm * 100).toFixed(0)}%`);
    if (typeof mastery === "number") {
      const gap = declaredNorm - mastery;
      const verdict = Math.abs(gap) <= 0.15 ? "✅ well-calibrated"
        : gap > 0 ? "⚠️ OVER-confident (you rated yourself above your measured mastery)"
                  : "ℹ️ UNDER-confident (you know more than you think)";
      p(`📏 measured mastery on ${cid?.replace(/^concept:/, "").replace(/-\d+$/, "")}: ${(mastery * 100).toFixed(0)}%`);
      p(`   calibration gap: ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(0)} pts → ${verdict}`);
    }
    p("");
    p(`🔧 engine: transition=${tr.kind}${tr.calibration ? `, calibration panel on concept ${tr.calibration.targetConcept}` : ""}`);
    if (tr.kind === "complete" && tr.summary) p(`   lesson complete — autonomy ${tr.summary.autonomyRatio.toFixed(2)}`);
  }
}

await client.close();
console.log(out.join("\n"));
