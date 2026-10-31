// studium_critique.mjs — INTERACTIVE ai_critique mode over lesson-mcp. Fast-forwards to the
// ai_critique scene, shows the planted (flawed) claims, takes ONE free-text critique, and reports
// the engine's verdict (passed/remediated + mastery) plus the exact flaws caught vs missed.
// Offline scoring is the deterministic keyword matcher (matchClaimsAgainstCritique) — phrasing
// matters; name the specific flaws. Replay: pass your critique as a single quoted arg.
//
//   node studium_critique.mjs                 # show the claims + prompt
//   node studium_critique.mjs "my critique"   # submit + see caught/missed

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = resolve(HERE, "../..", "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-enriched.json";
const critique = process.argv.slice(2).join(" ").trim();

// Same logic as packages/.../grading/ai-audit-matcher.ts (kept in sync) so we can show the EXACT
// caught/missed the engine's offline evaluator uses.
const norm = (t) => t.toLowerCase().replace(/[_-]/g, " ");
const flawMatches = (flaw, c) => {
  const needle = norm(flaw).trim();
  if (!needle) return false;
  if (c.includes(needle)) return true;
  const toks = norm(flaw).split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every((t) => c.includes(t));
};

const out = [];
const p = (s = "") => out.push(s);

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  // STUDIUM_EPHEMERAL=1: in memory, nothing written to ~/.studium (I-10).
  env: { BUNDLES_ROOT: "/tmp/studium_live", PATH: process.env.PATH, STUDIUM_EPHEMERAL: "1",
    // when set, switches the host to LIVE mode → HttpCritiqueEvaluator (the :8002 critique shim)
    ...(process.env.LITELLM_BASE_URL ? { LITELLM_BASE_URL: process.env.LITELLM_BASE_URL } : {}),
    ...(process.env.LITELLM_API_KEY ? { LITELLM_API_KEY: process.env.LITELLM_API_KEY } : {}),
    ...(process.env.STUDIUM_PSEUDO_SECRET ? { STUDIUM_PSEUDO_SECRET: process.env.STUDIUM_PSEUDO_SECRET } : {}) },
  stderr: "ignore",
});
const client = new Client({ name: "studium-critique", version: "0.1.0" });
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

// fast-forward to the ai_critique scene
let guard = 0;
while (pres.scene.type !== "ai_critique" && guard++ < 200) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") input = { kind: "quiz_choice", choiceId: (sc.choices.find((c) => c.correct) ?? sc.choices[0]).id };
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else input = { kind: "ack" };
  const t = await call("submit_response", { session_id: sid, input });
  if (t.transition.kind === "complete") { p("(reached end without an ai_critique scene)"); break; }
  pres = t.transition.presentation;
}

const scene = pres.scene;
if (scene.type === "ai_critique") {
  const claims = scene.claims ?? [];
  p(`🧪 AI-CRITIQUE — ${scene.title}`);
  p(`   The AI tutor states the following claim(s). Find what is WRONG with each:`);
  p("");
  claims.forEach((c, i) => p(`   claim-${i + 1}: ${c.text}`));

  if (!critique) {
    p("");
    p(`════════ YOUR TURN ════════`);
    p(`write a free-text critique (one message) refuting the flaws in BOTH claims.`);
  } else {
    const live = !!process.env.LITELLM_BASE_URL;
    // Fetch the SAME evaluator's verdict for display (the engine calls it internally for the
    // transition; we call it directly to show score+feedback). Live → :8002 Claude shim (semantic).
    let evalResult = null;
    if (live) {
      try {
        const r = await fetch("http://127.0.0.1:8002/scenes/critique-eval", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claims, rubric: scene.rubric, student_critique: critique }),
        });
        if (r.ok) evalResult = await r.json();
      } catch { /* shim down → fall through to keyword view */ }
    }
    const t = await call("submit_response", { session_id: sid, input: { kind: "critique", text: critique } });
    const tr = t.transition;
    p("");
    p(`🧑 your critique: ${critique}`);
    p("");
    if (evalResult) {
      const s = Math.max(0, Math.min(1, Number(evalResult.score)));
      p(`🤖 LLM critique score (semantic): ${(s * 100).toFixed(0)}% → ${s >= 0.6 ? "PASS" : "below 0.6 pass bar"}`);
      p(`   feedback: ${evalResult.feedback}`);
    } else {
      // offline fallback: deterministic keyword matcher
      const c = norm(critique);
      const allFlaws = claims.flatMap((cl) => (cl.flaws_expected ?? []).map((f) => ({ claim: cl.id, flaw: f })));
      const caught = allFlaws.filter((f) => flawMatches(f.flaw, c));
      const missed = allFlaws.filter((f) => !flawMatches(f.flaw, c));
      const score = allFlaws.length ? caught.length / allFlaws.length : 0;
      p(`📊 offline keyword-matcher score: ${caught.length}/${allFlaws.length} (${(score * 100).toFixed(0)}%) → ${score >= 0.6 ? "PASS" : "below 0.6"}`);
      p(`   ✓ caught: ${caught.map((f) => `"${f.flaw}"`).join("; ") || "(none)"}`);
      p(`   ✗ missed: ${missed.map((f) => `"${f.flaw}"`).join("; ") || "(none)"}`);
    }
    p("");
    p(`🔧 engine verdict: transition=${tr.kind}${tr.reason ? ` (${tr.reason})` : ""}`);
    const snap = tr.presentation?.learnerSnapshot;
    if (snap) p(`   mastery: ${Object.entries(snap.conceptMastery ?? {}).map(([k, v]) => `${k.replace(/^concept:/, "").replace(/-\d+$/, "")}=${v.toFixed(2)}`).join("  ")}`);
  }
}

await client.close();
console.log(out.join("\n"));
