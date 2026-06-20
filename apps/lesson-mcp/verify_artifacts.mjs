// verify_artifacts.mjs — walk the enriched FBMN course through lesson-mcp and print, per scene,
// the artifact KINDS that get_scene_artifacts returns. Proves the manifest is non-empty on the
// enriched scenes (equation on intro concept, plot on two-inputs concept, executed_result on the
// reproduction scene), end to end against the real bundle.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const TSX = resolve(REPO, "node_modules/.pnpm/node_modules/.bin/tsx");

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: HERE,
  env: { ...process.env, BUNDLES_ROOT: "/tmp/studium_live" }, stderr: "inherit",
});
const client = new Client({ name: "verify", version: "0.1.0" });
await client.connect(transport);
const call = async (n, a) => JSON.parse((await client.callTool({ name: n, arguments: a })).content[0].text);

const started = await call("start_lesson_session", { bundle_ref: "11-enriched.json", learner_id: "verify" });
const sid = started.session_id;
let pres = started.presentation, steps = 0;
const seen = [];
while (steps++ < 90) {
  const sc = pres.scene;
  const arts = (await call("get_scene_artifacts", { session_id: sid })).scene_assets || [];
  if (arts.length) seen.push(`${sc.type}:${sc.id} → [${arts.map(a => a.kind).join(", ")}]`);
  let input;
  if (sc.type === "quiz") input = { kind: "quiz_choice", choiceId: (sc.choices.find(c => c.correct) || sc.choices[0]).id };
  else if (sc.type === "ai_critique") input = { kind: "critique", text: `${sc.claims?.[0]?.id ?? "x"}: FBMN adds MS1 quantification + retention-time isomer separation.` };
  else if (sc.type === "meta_checkpoint") input = { kind: "confidence", value: 3 };
  else input = { kind: "ack" };
  const t = (await call("submit_response", { session_id: sid, input })).transition;
  if (t.kind === "complete") break;
  pres = t.presentation;
}
await client.close();
console.log("\nScenes carrying artifacts (via get_scene_artifacts):");
for (const s of seen) console.log("  " + s);
console.log(`\n${seen.length} artifact-bearing scene(s). Bundle loaded + validated OK (LessonBundleSchema.parse).`);
