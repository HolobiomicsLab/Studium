// headless_smoke.mjs — prove lesson-mcp is drivable by ANY MCP client, with zero VS Code plumbing.
//
// This is the §9 deployment claim (C8/C11) made executable: a bare @modelcontextprotocol/sdk
// client spawns the server over stdio, checks the tool surface, starts a real lesson from the
// shipped fixtures, submits a response, and reads the render manifest. No studium-vscode import.
//
// Run from the repo root:  node apps/lesson-mcp/scripts/headless_smoke.mjs
// (CI runs it the same way. Uses the repo tsx to run src/index.ts, like any dev harness would.)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(MCP_DIR, "..", "..");
const TSX = [
  resolve(REPO_ROOT, "node_modules/.pnpm/node_modules/.bin/tsx"),
  resolve(REPO_ROOT, "node_modules/.bin/tsx"),
].find(existsSync) ?? "tsx";

// The core tool surface the manuscript's §9 describes; peer/community tools are additive.
const CORE_TOOLS = [
  "start_lesson_session", "get_current_scene", "submit_response", "get_scene_artifacts",
  "request_hint", "explain_last_adaptation", "get_run_manifest", "submit_run_result",
  "get_operator_context", "set_session_language",
];

const failures = [];
let checks = 0;
const expect = (cond, msg) => { checks++; if (!cond) failures.push(msg); };

const transport = new StdioClientTransport({
  command: TSX, args: ["src/index.ts"], cwd: MCP_DIR,
  env: { ...process.env, BUNDLES_ROOT: resolve(REPO_ROOT, "fixtures") }, stderr: "pipe",
});
transport.stderr?.on("data", () => {});
const client = new Client({ name: "headless-smoke", version: "0.0.1" });
await client.connect(transport);

const payload = (r) => JSON.parse(r.content?.[0]?.text ?? "{}");

const tools = (await client.listTools()).tools.map((t) => t.name);
for (const t of CORE_TOOLS) expect(tools.includes(t), `tool surface misses ${t}`);

const started = payload(await client.callTool({ name: "start_lesson_session",
  arguments: { bundle_ref: "atomistique-l1/lesson.json", learner_id: "headless-smoke", presentation_language: "en-GB" } }));
expect(typeof started.session_id === "string" && started.session_id.length > 0, "no session_id");
expect(started.presentation != null, "no first-scene presentation");
expect(started.language?.selected_language === "en-GB", "initial presentation language missing");
const sid = started.session_id;

const changedLanguage = payload(await client.callTool({ name: "set_session_language",
  arguments: { session_id: sid, presentation_language: "fr-CA" } }));
expect(changedLanguage.language?.selected_language === "fr-CA", "presentation language did not change");
const operatorContext = payload(await client.callTool({ name: "get_operator_context", arguments: { session_id: sid } }));
expect(operatorContext.language?.selected_language === "fr-CA", "operator context language drifted");

const scene = payload(await client.callTool({ name: "get_current_scene", arguments: { session_id: sid } }));
expect(scene.presentation != null || scene.scene != null, "get_current_scene returned nothing");

const acked = payload(await client.callTool({ name: "submit_response",
  arguments: { session_id: sid, input: { kind: "ack" } } }));
expect(acked.transition != null, "submit_response(ack) returned no transition");

const artifacts = payload(await client.callTool({ name: "get_scene_artifacts", arguments: { session_id: sid } }));
expect(Array.isArray(artifacts.scene_assets), "scene_assets is not an array");

const graph = payload(await client.callTool({ name: "get_workflow_graph", arguments: { session_id: sid } }));
expect((graph.graph?.nodes ?? graph.nodes ?? []).length > 0, "workflow graph is empty");

await client.callTool({ name: "end_session", arguments: { session_id: sid } });
await client.close();

if (failures.length) {
  console.error(`FAIL (${failures.length}/${checks}):`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`OK — headless MCP client drove a real lesson: all ${checks} assertions passed (no VS Code code involved)`);
