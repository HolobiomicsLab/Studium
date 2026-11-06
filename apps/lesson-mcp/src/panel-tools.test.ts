import { it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostBackend, registerPanelTools } from "./panel-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SessionHost } from "@studium/lesson-session-host";
import { buildMcpServer } from "./server.js";

it("opens, reads and advances a panel over MCP with no UI metadata or pre-answer key", async () => {
  const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "panel-test", version: "1" });
  await client.connect(clientT);
  try {
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(37);
    for (const name of ["open_lesson_panel", "get_panel_view", "panel_action"]) {
      expect(tools.find(t => t.name === name)).toBeDefined();
      expect(tools.find(t => t.name === name)?._meta?.ui).toBeUndefined();
    }
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as {
      isError?: boolean; structuredContent?: { panel: Record<string, any> }; content: Array<{ type: string; text?: string }>;
    };
    const opened = await call("open_lesson_panel", { bundle_ref: "atomistique-l1/lesson.json", learner_id: "panel-test" });
    expect(opened.isError).not.toBe(true);
    const panel = opened.structuredContent?.panel as Record<string, any>;
    expect(panel).toMatchObject({ kind: "scene", schema: "studium/panel-view/1", progress: { index: 1 }, mastery: {} });
    expect(JSON.stringify(panel)).not.toMatch(/"(?:answer|correct|expected|key|solution)"\s*:/);
    expect(opened.content[1]).toMatchObject({ type: "text", text: expect.stringContaining(panel.lesson_title) });
    expect((await call("get_panel_view", { session_id: panel.session_id })).structuredContent?.panel).toEqual(panel);
    const next = await call("panel_action", { session_id: panel.session_id, action: { type: "respond", input: { kind: "ack" } } });
    expect(next.isError).not.toBe(true);
    expect(next.structuredContent?.panel).toMatchObject({ progress: { index: 2 }, navigation: expect.any(Object) });
    expect((await call("panel_action", { session_id: panel.session_id, action: { type: "end" } })).isError).toBe(true);
  } finally { await client.close(); await server.close(); }
});

it("inlines images from a library lesson opened by directory and refuses escapes", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "panel-library-"));
  try {
    const library = resolve(root, "library");
    const course = resolve(library, "course");
    mkdirSync(course, { recursive: true });
    writeFileSync(resolve(course, "lesson.json"), readFileSync(resolve("../../fixtures/atomistique-l1/lesson.json")));
    writeFileSync(resolve(course, "figure.png"), "figure");
    writeFileSync(resolve(library, "outside.png"), "outside");
    const host = new SessionHost({ bundlesRoot: resolve(root, "bundles"), libraryRoot: library, live: false, dataDir: null });
    const backend = hostBackend(host, host.bundlesRoot);
    expect(await backend.inlineImage({ kind: "image", path: "figure.png" }, "course")).toMatchObject({ dataUri: "data:image/png;base64,ZmlndXJl" });
    expect(await backend.inlineImage({ kind: "image", path: "../outside.png" }, "course")).not.toHaveProperty("dataUri");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("panel bookkeeping cannot turn a successful legacy operation into a failure", async () => {
  const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false, dataDir: null });
  const server = new McpServer({ name: "panel-test", version: "1" });
  const panels = registerPanelTools(server, host);
  // A session can disappear between the legacy reply and presentation bookkeeping.
  await expect(panels.observe("start_lesson_session", {}, { content: [{ type: "text", text: '{"session_id":"already-closed"}' }] })).resolves.toBeUndefined();
  await server.close();
});

it("advertises and serves exactly two UI resources only after a UI-capable handshake", async () => {
  for (const supportsUi of [false, true]) {
    const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false, dataDir: null });
    const server = buildMcpServer(host);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: "panel-ui-test", version: "1" }, {
      capabilities: supportsUi ? { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } : {},
    });
    await client.connect(clientT);
    try {
      const tools = (await client.listTools()).tools;
      const uiTools = tools.filter(tool => tool._meta?.ui);
      expect(uiTools.map(tool => tool.name).sort()).toEqual(supportsUi ? ["get_panel_view", "get_workflow_graph", "open_lesson_panel", "panel_action"] : []);
      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(supportsUi ? 2 : 0);
      if (!supportsUi) {
        await expect(client.readResource({ uri: "ui://studium/lesson-panel.html" })).rejects.toThrow();
        continue;
      }
      for (const resource of resources.resources) {
        const read = await client.readResource({ uri: resource.uri });
        expect(read.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app", _meta: { ui: { csp: { resourceDomains: ["https://cdn.jsdelivr.net"] }, prefersBorder: true } } });
        const html = (read.contents[0] as { text: string }).text;
        expect(html).toContain("studium/panel-view/1");
        expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1_500_000);
      }
    } finally { await client.close(); await server.close(); }
  }
});
