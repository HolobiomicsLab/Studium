import { it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostBackend, negotiateSurface, registerPanelTools } from "./panel-tools.js";
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
    expect(tools).toHaveLength(39);
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
    expect(panel).toMatchObject({ kind: "scene", schema: "studium/panel-view/2", progress: { index: 1 }, mastery: {} });
    // INT-STUDIUM-058: the view says where the learner is, who speaks and which help is open.
    expect(panel).toMatchObject({
      orientation: { step: { index: 1, total: 32 }, waiting: "read", reviews_due: 0 },
      voices: { scene: { kind: "author", reviewed: true, drafted_by: "teacher" } },
      prompts: [], attention: "normal", surface: { rank: 1, kind: "text", available: ["text"] },
    });
    expect(panel.status_line).toContain("étape 1/32");
    expect(panel.status_line.length).toBeLessThanOrEqual(80);
    expect(panel.help.rungs.map((r: { kind: string }) => r.kind)).toEqual(["reread", "hint", "explain", "reference"]);
    expect(JSON.stringify(panel)).not.toMatch(/"(?:answer|correct|expected|key|solution)"\s*:/);
    expect(opened.content[1]).toMatchObject({ type: "text", text: expect.stringContaining(panel.lesson_title) });
    expect((await call("get_panel_view", { session_id: panel.session_id })).structuredContent?.panel).toEqual(panel);
    const next = await call("panel_action", { session_id: panel.session_id, action: { type: "respond", input: { kind: "ack" } } });
    expect(next.isError).not.toBe(true);
    expect(next.structuredContent?.panel).toMatchObject({ progress: { index: 2 }, navigation: expect.any(Object) });
    expect(next.structuredContent?.panel).toMatchObject({ schema: "studium/panel-view/2", orientation: { step: { index: 2, total: 32 } } });
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
        if (resource.uri.includes("lesson-panel")) expect(html).toContain("studium/panel-view/2");
        expect(Buffer.byteLength(html)).toBeLessThanOrEqual(1_500_000);
      }
    } finally { await client.close(); await server.close(); }
  }
});

// INT-STUDIUM-058 § 2.4, lot 2, task 2.1: one call opens the lesson on the best surface the host can
// render, from what the client declared and what the adapter or the learner asked for, and says which.
const UI = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } };
const FORMS = { elicitation: {} };

async function connected(capabilities: Record<string, unknown>) {
  const host = new SessionHost({ bundlesRoot: resolve("../../fixtures"), live: false, dataDir: null });
  const server = buildMcpServer(host);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "surface-test", version: "1" }, { capabilities });
  await client.connect(clientT);
  const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as {
    isError?: boolean; structuredContent?: { panel: Record<string, any> }; content: Array<{ type: string; text?: string }>;
  };
  const open = (extra: Record<string, unknown> = {}) =>
    call("open_lesson_panel", { bundle_ref: "atomistique-l1/lesson.json", learner_id: "auto-test-surface", ...extra });
  return { call, open, close: async () => { await client.close(); await server.close(); } };
}
/** The line of the result written for the model. */
const forModel = (result: { content: Array<{ text?: string }> }) => result.content[1]?.text ?? "";

it("picks the surface from what the client declared: panel, forms, or the conversation", async () => {
  const cases = [
    { capabilities: UI, surface: { rank: 3, kind: "panel", available: ["text", "panel"] }, says: null },
    { capabilities: FORMS, surface: { rank: 2, kind: "form", available: ["text", "form"] }, says: "play_in_forms" },
    { capabilities: {}, surface: { rank: 1, kind: "text", available: ["text"] }, says: "get_current_scene" },
  ];
  for (const c of cases) {
    const { open, call, close } = await connected(c.capabilities);
    try {
      const opened = await open();
      expect(opened.isError).not.toBe(true);
      const panel = opened.structuredContent!.panel;
      expect(panel.surface).toEqual(c.surface);
      // Below a panel, the text for the model says in one line how the lesson goes on.
      if (c.says) expect(forModel(opened)).toContain(c.says);
      else expect(forModel(opened)).not.toMatch(/play_in_forms|get_current_scene/);
      // The same surface on a later read and after an action.
      expect((await call("get_panel_view", { session_id: panel.session_id })).structuredContent!.panel.surface).toEqual(c.surface);
      const next = await call("panel_action", { session_id: panel.session_id, action: { type: "respond", input: { kind: "ack" } } });
      expect(next.structuredContent!.panel.surface).toEqual(c.surface);
    } finally { await close(); }
  }
});

it("lets the learner or the adapter ask for a surface, and falls to the one below when the client lacks it", async () => {
  // The learner prefers the conversation: rank 1 whatever the client can render.
  const rich = await connected({ ...UI, ...FORMS });
  try {
    const opened = await rich.open({ surface: "text" });
    expect(opened.structuredContent!.panel.surface).toEqual({ rank: 1, kind: "text", available: ["text", "form", "panel"] });
    expect(forModel(opened)).toContain("get_current_scene");
  } finally { await rich.close(); }
  // A native pane cannot be detected: its adapter says so. The session keeps it, until a read asks otherwise.
  const plain = await connected({});
  try {
    const pane = { rank: 3, kind: "pane", available: ["text", "pane"] };
    const opened = await plain.open({ surface: "pane" });
    const sid = opened.structuredContent!.panel.session_id;
    expect(opened.structuredContent!.panel.surface).toEqual(pane);
    expect((await plain.call("get_panel_view", { session_id: sid })).structuredContent!.panel.surface).toEqual(pane);
    const read = await plain.call("get_panel_view", { session_id: sid, surface: "text" });
    expect(read.structuredContent!.panel.surface).toEqual({ rank: 1, kind: "text", available: ["text"] });
    // Asked for a panel this client cannot render: the conversation.
    expect((await plain.open({ surface: "panel" })).structuredContent!.panel.surface).toMatchObject({ rank: 1, kind: "text" });
    expect((await plain.call("open_lesson_panel", { bundle_ref: "atomistique-l1/lesson.json", surface: "window" })).isError).toBe(true);
  } finally { await plain.close(); }
  // Asked for a panel on a client that only shows forms: forms.
  const forms = await connected(FORMS);
  try {
    expect((await forms.open({ surface: "panel" })).structuredContent!.panel.surface).toEqual({ rank: 2, kind: "form", available: ["text", "form"] });
  } finally { await forms.close(); }
});

it("negotiateSurface — the ladder", () => {
  expect(negotiateSurface({ ui: true, forms: true })).toEqual({ rank: 3, kind: "panel", available: ["text", "form", "panel"] });
  expect(negotiateSurface({ ui: false, forms: true })).toEqual({ rank: 2, kind: "form", available: ["text", "form"] });
  expect(negotiateSurface({ ui: false, forms: false })).toEqual({ rank: 1, kind: "text", available: ["text"] });
  expect(negotiateSurface({ ui: true, forms: false }, "form")).toEqual({ rank: 1, kind: "text", available: ["text", "panel"] });
  expect(negotiateSurface({ ui: true, forms: true }, "pane")).toEqual({ rank: 3, kind: "pane", available: ["text", "form", "panel", "pane"] });
  expect(negotiateSurface({ ui: true, forms: true }, "form")).toMatchObject({ rank: 2, kind: "form" });
});

// Task 2.2: the acts of the fast lane that need no model turn, through the real server.
it("applies language, attention, replan and ask through panel_action", async () => {
  const { open, call, close } = await connected({});
  try {
    const opened = await open({ attention: "coached" });
    const panel = opened.structuredContent!.panel;
    expect(panel.attention).toBe("coached");
    const act = async (action: Record<string, unknown>) =>
      (await call("panel_action", { session_id: panel.session_id, action })).structuredContent!.panel;
    const en = await act({ type: "setLanguage", presentation_language: "en" });
    expect(en.locale).toBe("en");
    expect(en.status_line).toContain("step 1/32");
    expect((await act({ type: "setAttention", level: "quiet" })).attention).toBe("quiet");
    const planned = await act({ type: "replan", minutes: 10 });
    expect(planned.prompts).toHaveLength(1);
    expect(planned.prompts[0]).toMatchObject({ kind: "replan", expires: "scene", actions: [] });
    expect(planned.prompts[0].reason).toMatch(/10 min.*78/);
    const asked = await act({ type: "ask", text: "Why does Z define the element?" });
    expect(asked).toMatchObject({ kind: "notice", scene: { id: panel.scene.id }, progress: { index: 1 }, attention: "quiet" });
    expect(asked.message).toContain("conversation");
    expect(JSON.stringify(asked)).not.toMatch(/"(?:answer|correct|expected|key|solution)"\s*:/);
    expect((await call("panel_action", { session_id: panel.session_id, action: { type: "teleport" } })).isError).toBe(true);
  } finally { await close(); }
});

// INT-STUDIUM-058 § 2.3: a surface reports the delay between the learner's previous action and its
// display. The server takes it beside the action; the interaction log of lot 7 records it under consent.
it("panel_action takes a display delay (client_ms) and refuses what is not a delay", async () => {
  const { open, call, close } = await connected({});
  try {
    const panel = (await open({})).structuredContent!.panel;
    const action = { type: "setAttention", level: "quiet" };
    const taken = await call("panel_action", { session_id: panel.session_id, action, client_ms: 180 });
    expect(taken.isError).toBeFalsy();
    expect(taken.structuredContent!.panel.attention).toBe("quiet");
    for (const bad of [-1, 1.5, 700_000, "180"]) {
      expect((await call("panel_action", { session_id: panel.session_id, action, client_ms: bad })).isError, `client_ms ${JSON.stringify(bad)}`).toBe(true);
    }
  } finally { await close(); }
});
