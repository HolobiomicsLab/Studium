// Exercise the bundled server and its exact embedded MCP App, without external network assets.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
const require = createRequire(new URL("../apps/lesson-mcp/package.json", import.meta.url));
const uiRequire = createRequire(new URL("../apps/lesson-panel-ui/package.json", import.meta.url));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const { JSDOM } = uiRequire("jsdom");
const root = fileURLToPath(new URL("../", import.meta.url));
const http = process.argv.find(arg => arg.startsWith("--http="))?.slice(7);
const domPath = process.argv.find(arg => arg.startsWith("--dom="))?.slice(6);
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error("Panel DOM timed out"); await pause(); }
}
async function proveEmbeddedApp(client, html, opened) {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder; win.structuredClone = structuredClone;
  win.console.debug = () => {};
  let ready = false, latest = opened.structuredContent.panel, actions = 0, sizes = 0;
  const deliver = data => win.dispatchEvent(new win.MessageEvent("message", { data, source: host }));
  const host = { postMessage: async request => {
    if (request.method === "ui/initialize") {
      queueMicrotask(() => deliver({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "Studium contract host", version: "1" }, hostCapabilities: { serverTools: {}, openLinks: {} }, hostContext: { theme: "dark", locale: "en-US" } } }));
    } else if (request.method === "ui/notifications/initialized") {
      ready = true; queueMicrotask(() => deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: opened }));
    } else if (request.method === "tools/call") {
      const result = await client.callTool(request.params); latest = result.structuredContent?.panel ?? latest; actions++;
      deliver({ jsonrpc: "2.0", id: request.id, result });
    } else if (request.method === "ui/notifications/size-changed") sizes++;
  } };
  Object.defineProperty(win, "parent", { value: host });
  try {
    for (const script of win.document.querySelectorAll("script:not([src])")) win.eval(script.textContent);
    await waitFor(() => ready && win.document.querySelector(".controls button.primary"));
    assert.equal(win.document.documentElement.lang, "en");
    assert.equal(win.document.documentElement.dataset.theme, "dark");
    win.document.querySelector(".controls button.primary").click();
    await waitFor(() => actions === 1 && latest.progress.index === 2 && win.document.querySelector("#pane").getAttribute("aria-busy") === "false");
    assert.ok(sizes > 0);
    if (domPath) writeFileSync(domPath, `<!doctype html><html lang="en" data-theme="dark"><body>${win.document.querySelector("#pane").outerHTML}</body></html>`);
    return { handshake: ready, actions, progress: latest.progress, sizes, dom: domPath ?? null };
  } finally { dom.window.close(); }
}
for (const supportsUi of [false, true]) {
  const capabilities = supportsUi ? { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } } : {};
  const client = new Client({ name: "panel-probe", version: "1" }, { capabilities });
  const transport = http ? new StreamableHTTPClientTransport(new URL(http)) : new StdioClientTransport({ command: process.execPath, args: [`${root}apps/lesson-mcp/dist/studium-mcp.cjs`], env: { STUDIUM_EPHEMERAL: "1", BUNDLES_ROOT: `${root}fixtures`, LITELLM_BASE_URL: "" }, stderr: "pipe" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 39);
    const uiTools = tools.filter(tool => tool._meta?.ui);
    assert.equal(uiTools.length, supportsUi ? 4 : 0);
    const resources = (await client.listResources()).resources;
    assert.equal(resources.length, supportsUi ? 2 : 0);
    const opened = await client.callTool({ name: "open_lesson_panel", arguments: { bundle_ref: "atomistique-l1", learner_id: "panel-probe" } });
    assert.notEqual(opened.isError, true, JSON.stringify(opened));
    assert.doesNotMatch(JSON.stringify(opened.structuredContent.panel), /"(?:answer|correct|expected|key|solution)"\s*:/);
    assert.equal(opened.structuredContent.panel.schema, "studium/panel-view/2");
    assert.ok(opened.structuredContent.panel.status_line.length <= 80);
    const sizes = {};
    let app;
    if (supportsUi) for (const resource of resources) {
      const result = await client.readResource({ uri: resource.uri }); const content = result.contents[0];
      assert.equal(content.mimeType, "text/html;profile=mcp-app");
      assert.deepEqual(content._meta.ui.csp.resourceDomains, ["https://cdn.jsdelivr.net"]);
      assert.ok(content.text.includes("studium/panel-view/1"));
      if (resource.uri.includes("lesson-panel")) assert.ok(content.text.includes("studium/panel-view/2"));
      sizes[resource.uri] = Buffer.byteLength(content.text); assert.ok(sizes[resource.uri] <= 1_500_000);
      if (resource.uri.includes("lesson-panel")) app = await proveEmbeddedApp(client, content.text, opened);
    }
    else await assert.rejects(client.readResource({ uri: "ui://studium/lesson-panel.html" }));
    console.log(JSON.stringify({ ui: supportsUi, tools: tools.length, annotated_tools: uiTools.length, resources: resources.length, sizes, app, forbidden_keys: 0 }));
  } finally { if (http) await transport.terminateSession(); await client.close(); }
}
