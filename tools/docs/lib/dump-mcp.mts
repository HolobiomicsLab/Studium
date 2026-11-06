// tools/docs/lib/dump-mcp.mts — print, as JSON on stdout, what an MCP client sees of the Studium
// server: its instructions, every tool (name, description, JSON Schema of its input) with the group
// it belongs to, and the prompts. Run through tsx by tools/docs/gen-mcp-tools.mjs; it reads the
// tools over a real MCP connection (in memory), so the schemas are the ones a harness receives.
//
// The server runs in memory only (STUDIUM_EPHEMERAL=1) with a temporary STUDIUM_HOME: nothing is
// written to the learner's home directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../../../apps/lesson-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { InMemoryTransport } from "../../../apps/lesson-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { hostFromEnvironment } from "../../../apps/lesson-mcp/src/index.js";
import { buildMcpServer, SERVER_INSTRUCTIONS, STUDY_TOOL_NAMES } from "../../../apps/lesson-mcp/src/server.js";
import { TOOL_NAMES as LESSON_TOOL_NAMES } from "../../../apps/lesson-mcp/src/operations.js";
import { AUTHORING_TOOL_NAMES } from "../../../apps/lesson-mcp/src/authoring-tools.js";
import { TEACHER_TOOL_NAMES } from "../../../apps/lesson-mcp/src/teacher-tools.js";
import { FORM_TOOL_NAMES } from "../../../apps/lesson-mcp/src/form-tools.js";
import { PANEL_TOOL_NAMES } from "../../../apps/lesson-mcp/src/panel-tools.js";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const home = mkdtempSync(join(tmpdir(), "studium-docs-"));
const env = { STUDIUM_EPHEMERAL: "1", STUDIUM_HOME: home, BUNDLES_ROOT: join(repoRoot, "fixtures") };

const groups: Record<string, readonly string[]> = {
  lesson: LESSON_TOOL_NAMES, study: STUDY_TOOL_NAMES, authoring: AUTHORING_TOOL_NAMES, teacher: TEACHER_TOOL_NAMES,
  form: FORM_TOOL_NAMES, panel: PANEL_TOOL_NAMES,
};
const groupOf = (name: string): string =>
  Object.entries(groups).find(([, names]) => names.includes(name))?.[0] ?? "other";

try {
  const { host } = hostFromEnvironment(env, home);
  const server = buildMcpServer(host);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "studium-docs", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  const { prompts } = await client.listPrompts();
  await client.close();
  process.stdout.write(JSON.stringify({
    instructions: SERVER_INSTRUCTIONS,
    tools: tools.map((t) => ({ name: t.name, group: groupOf(t.name), description: t.description ?? "", inputSchema: t.inputSchema })),
    prompts: prompts.map((p) => ({ name: p.name, title: p.title ?? "", description: p.description ?? "", arguments: p.arguments ?? [] })),
  }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
