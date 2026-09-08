// studium_repro.mjs — view the reproduction mode over lesson-mcp: fast-forward to the
// reproduction scene and show its executed capsule "reference run" (the real author-time
// computation a student reproduces) — task steps, rendered figure, landmark, graded checks,
// and capsule provenance — via get_scene_artifacts + the scene's reference_result.
//
//   node studium_repro.mjs

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TSX = resolve(HERE, "../..", "node_modules/.pnpm/node_modules/.bin/tsx");
const BUNDLE_REF = process.env.BUNDLE_REF ?? "11-enriched.json";

const out = [];
const p = (s = "") => out.push(s);

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  env: { BUNDLES_ROOT: "/tmp/studium_live", PATH: process.env.PATH }, stderr: "ignore",
});
const client = new Client({ name: "studium-repro", version: "0.1.0" });
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

let guard = 0;
while (pres.scene.type !== "reproduction" && guard++ < 200) {
  const sc = pres.scene;
  let input;
  if (sc.type === "quiz") input = { kind: "quiz_choice", choiceId: (sc.choices.find((c) => c.correct) ?? sc.choices[0]).id };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: "auto" };
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else input = { kind: "ack" };
  const t = await call("submit_response", { session_id: sid, input });
  if (t.transition.kind === "complete") { p("(reached end without a reproduction scene)"); break; }
  pres = t.transition.presentation;
}

const scene = pres.scene;
if (scene.type === "reproduction") {
  p(`🔬 REPRODUCTION — ${scene.title}`);
  p(`   task_card: ${scene.task_card_id}`);
  p(`   steps:`);
  (scene.steps ?? []).forEach((s, i) => p(`     ${i + 1}. ${s.instruction}`));

  const arts = await call("get_scene_artifacts", { session_id: sid });
  const kinds = (arts.artifacts ?? arts.assets ?? []).map((a) => a.kind);
  p("");
  p(`   render manifest (get_scene_artifacts): [${kinds.join(", ")}]`);

  const rr = scene.reference_result;
  if (rr) {
    p("");
    p(`   ▶ EXECUTED reference run (ran at author time by the capsule runner):`);
    p(`     ran=${rr.ran}  passed=${rr.passed}`);
    if (rr.landmark) p(`     landmark: ${rr.landmark}`);
    if (rr.figure_path) p(`     figure: ${rr.figure_path}`);
    if (rr.checks?.length) p(`     graded checks: ${rr.checks.map((c) => `${c.check}=${c.passed ? "✓" : "✗"}`).join("  ")}`);
    if (rr.provenance) p(`     provenance: cmd=${JSON.stringify(rr.provenance.cmd)} env=${rr.provenance.env}${rr.provenance.capsule_doi ? ` doi=${rr.provenance.capsule_doi}` : ""}`);
  } else if (scene.image_path) {
    p(`     figure (image_path): ${scene.image_path}`);
  } else {
    p(`     (no reference_result on this scene — heavy/deferred capsule shows step-text only)`);
  }
  p("");
  p(`   In the VS Code artifact pane this renders as an "executed_result" card (figure + checks +`);
  p(`   landmark + provenance). The student then reproduces it; the grader is currently ack (Mode-A).`);
}

await client.close();
console.log(out.join("\n"));
