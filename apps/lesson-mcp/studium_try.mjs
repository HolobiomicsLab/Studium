// studium_try.mjs — INTERACTIVE replay driver for a live Studium lesson over the
// lesson-mcp MCP server. Because each shell invocation is a fresh process, we replay
// the answers given so far (engine is deterministic at runtime, live=false), auto-advance
// reading scenes, and STOP at the next quiz so the human can answer.
//
//   node studium_try.mjs <answer1> <answer2> ...
//
// Each <answerN> is consumed at a quiz: "a" | "b" | "c" = a choice; "hint" = pull a hint
// first (then the following token is the choice). intro/concept auto-continue; ai_critique
// and meta_checkpoint are auto-handled. In-memory (no STUDIUM_DATA_DIR) → clean fresh replay.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const TSX = resolve(REPO, "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLES_ROOT = process.env.BUNDLES_ROOT ?? "/tmp/studium_live";
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-enriched.json";

const answers = process.argv.slice(2);          // quiz answers given so far
let ans = 0;                                     // pointer into answers

const out = [];                                  // full transcript lines
let printFrom = 0;                               // index of first "new since last answer" line
const p = (s = "") => out.push(s);

async function main() {
  const transport = new StdioClientTransport({
    command: TSX, args: ["src/index.ts"], cwd: HERE,
    env: { BUNDLES_ROOT, PATH: process.env.PATH }, stderr: "ignore",   // no STUDIUM_DATA_DIR → in-memory, deterministic
  });
  const client = new Client({ name: "studium-try", version: "0.1.0" });
  await client.connect(transport);
  const call = async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    const data = JSON.parse(res.content?.[0]?.text ?? "{}");
    if (res.isError) throw new Error(`${name}: ${data.error}`);
    return data;
  };
  const mline = (snap) => {
    const m = snap?.conceptMastery ?? {};
    const parts = Object.entries(m).map(([k, v]) => `${k.replace(/^concept:/, "").replace(/-\d+$/, "")}=${v.toFixed(2)}`);
    return parts.length ? parts.join("  ") : "";
  };

  const started = await call("start_lesson_session", { bundle_ref: BUNDLE_REF, learner_id: "you" });
  const sid = started.session_id;
  let pres = started.presentation;
  let awaiting = null;                            // the quiz scene awaiting the human
  let steps = 0;

  while (steps++ < 120) {
    const scene = pres.scene;
    const n = `${pres.index + 1}/${pres.total}`;
    const type = scene.type;
    let input;

    if (type === "intro" || type === "concept") {
      const head = (scene.markdown || "").split("\n").find((l) => l.trim()) || "";
      p(`📖 [${n}] ${scene.title}`);
      if (head) p(`   ${head.slice(0, 150)}${head.length > 150 ? "…" : ""}`);
      // surface any rendered artifacts on this scene
      try {
        const art = await call("get_scene_artifacts", { session_id: sid });
        const kinds = (art.artifacts ?? art.assets ?? []).map((a) => a.kind);
        if (kinds.length) p(`   🎨 artifacts: ${kinds.join(", ")}`);
      } catch { /* tool optional */ }
      input = { kind: "ack" };
    } else if (type === "quiz") {
      if (ans >= answers.length) {                // ← no answer yet: this is the human's turn
        awaiting = { n, scene };
        break;
      }
      printFrom = out.length;                     // everything from here is "new" for this turn
      // consume leading hint tokens
      while (ans < answers.length && answers[ans].toLowerCase() === "hint") {
        const h = await call("request_hint", { session_id: sid });
        if (h.hint?.hint) p(`   💡 hint: ${h.hint.hint}`);
        ans++;
      }
      if (ans >= answers.length) {                // hint(s) given, choice still pending
        awaiting = { n, scene, hinted: true };
        break;
      }
      const choiceId = answers[ans++].toLowerCase();
      const chosen = scene.choices.find((c) => c.id === choiceId) ?? scene.choices[0];
      const ok = !!chosen.correct;
      p(`❓ [${n}] ${scene.question}`);
      p(`   ${ok ? "✓" : "✗"} you answered ${chosen.id}) ${chosen.text}`);
      input = { kind: "quiz_choice", choiceId: chosen.id };
    } else if (type === "ai_critique") {
      const claim = scene.claims?.[0];
      p(`🧪 [${n}] critique scene (auto-handled)`);
      input = { kind: "critique", text: claim ? `${claim.id}: classical MN gives only relative spectral-similarity grouping; FBMN adds MS1 peak-area quantification and resolves isomers by retention time.` : "critique" };
    } else if (type === "meta_checkpoint") {
      p(`🔎 [${n}] confidence checkpoint (auto: 3/4)`);
      input = { kind: "confidence", value: 3 };
    } else {
      input = { kind: "ack" };
    }

    const t = await call("submit_response", { session_id: sid, input });
    const tr = t.transition;
    if (tr.kind === "complete") {
      const s = tr.summary;
      p("");
      p(`✔ LESSON COMPLETE — scenes ${s.scenesCompleted}, autonomy ${s.autonomyRatio.toFixed(2)}`);
      const st = await call("get_session_state", { session_id: sid });
      const cs = st.state?.concept_states ?? {};
      p("   final mastery (local-only):");
      for (const [cid, c] of Object.entries(cs)) {
        const a = c.alpha ?? c.mastery_alpha, b = c.beta ?? c.mastery_beta;
        const m = (typeof a === "number" && typeof b === "number") ? (a / (a + b)).toFixed(2) : "?";
        p(`     ${cid.replace(/^concept:/, "")} ≈ ${m}`);
      }
      awaiting = "done";
      break;
    }
    // narrate adaptation
    if (tr.kind === "replay" || tr.kind === "remediate_alt") {
      const ex = await call("explain_last_adaptation", { session_id: sid }).catch(() => ({}));
      p(`   ↻ engine adapts: ${tr.kind} — ${tr.reason}`);
      if (ex.explanation) p(`     why: ${ex.explanation.rule_id} → ${ex.explanation.explanation_short} [${ex.explanation.modulator}]`);
    } else if (tr.kind === "calibration") {
      p(`   ⟳ calibration panel for ${tr.targetConcept}`);
    }
    const snap = tr.presentation?.learnerSnapshot;
    if (snap) { const ml = mline(snap); if (ml) p(`   mastery: ${ml}`); }
    pres = tr.presentation;
  }

  // render the awaiting quiz (the human's turn)
  if (awaiting && awaiting !== "done") {
    p("");
    p(`════════ YOUR TURN — quiz [${awaiting.n}] ════════`);
    p(awaiting.scene.question);
    for (const c of awaiting.scene.choices) p(`   ${c.id})  ${c.text}`);
    p("");
    p(`reply with a letter (a/b/c)  ·  or "hint" first if you want a nudge`);
  }

  await client.close();
  console.log(out.slice(printFrom).join("\n"));
}
main().catch((e) => { console.error("TRY ERROR:", e?.message ?? e); process.exit(1); });
