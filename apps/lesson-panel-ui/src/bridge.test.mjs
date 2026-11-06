// Exercise the transport boundary in a real DOM without a network or host installation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
const compiled = await build({ entryPoints: [new URL("bridge-mcp-app.js", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "browser" });
const { connectMcpApp } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const initial = { schema: "studium/panel-view/1", kind: "scene", session_id: "one", learner_id: "learner", bundle_ref: "course", lesson_title: "Lesson", locale: "fr", strings: {}, progress: { index: 1, total: 2 }, scene: { id: "intro", type: "concept", title: "Introduction", markdown: "The first idea" }, scene_assets: [], reviewDue: [], calibration: [], mastery: {}, actions: ["respond", "hint", "end"] };
function setup(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="pane"></div><a href="https://example.org/source">Source</a></body></html>', { runScripts: "outside-only" });
  dom.window.eval(readFileSync(new URL("artifact-pane.js", import.meta.url), "utf8").replace(/export \{ renderView \};?\s*$/, ""));
  const calls = [], links = [], sizes = [];
  const app = { connect: async () => {}, getHostContext: () => ({ locale: "en-US", theme: "dark" }), sendSizeChanged: size => { sizes.push(size); }, openLink: args => { links.push(args); }, callServerTool: async request => { calls.push(request); return { structuredContent: { panel: { ...initial, scene: { ...initial.scene, id: "next", title: "Next scene" }, progress: { index: 2, total: 2 } } } }; }, ...options };
  return { dom, app, calls, links, sizes, env: { window: dom.window, document: dom.window.document, renderView: dom.window.renderView } };
}
test("tool results render; actions round-trip, resize, localize and open links through the host", async () => {
  const m = setup();
  await connectMcpApp(m.app, m.env);
  m.app.ontoolresult({ structuredContent: { panel: initial } });
  assert.match(m.dom.window.document.body.textContent, /Introduction/);
  assert.equal(m.dom.window.document.documentElement.lang, "en");
  assert.equal(m.dom.window.document.documentElement.dataset.theme, "dark");
  await m.dom.window.__send({ type: "respond", input: { kind: "ack" } });
  assert.deepEqual(m.calls[0], { name: "panel_action", arguments: { session_id: "one", action: { type: "respond", input: { kind: "ack" } } } });
  assert.match(m.dom.window.document.body.textContent, /Next scene/);
  m.dom.window.document.querySelector("a").click();
  assert.deepEqual(m.links, [{ url: "https://example.org/source" }]);
  m.app.onhostcontextchanged({ theme: "light", locale: "fr-FR", containerDimensions: { width: 480 } });
  assert.equal(m.dom.window.document.documentElement.lang, "fr");
  assert.equal(m.dom.window.document.body.style.maxWidth, "480px");
  assert.ok(m.sizes.length >= 4);
  m.dom.window.close();
});
test("an in-flight action cannot be sent twice and settles after rejection", async () => {
  let reject;
  const m = setup({ callServerTool: () => new Promise((_, rejectCall) => { reject = rejectCall; }) });
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: initial } });
  const first = bridge.act({ type: "hint" });
  assert.equal(m.dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "true");
  await bridge.act({ type: "hint" });
  reject(new Error("Host disconnected")); await first;
  assert.equal(m.dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "false");
  assert.match(m.dom.window.document.body.textContent, /Host disconnected/);
  m.dom.window.close();
});
test("erasure needs an explicit DOM confirmation even if a caller supplies confirmed:true", async () => {
  const m = setup(); const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: initial } });
  const cancelled = bridge.act({ type: "end", confirmed: true });
  assert.equal(m.calls.length, 0);
  m.dom.window.document.querySelector('[role="alertdialog"] button:last-child').click(); await cancelled;
  assert.equal(m.calls.length, 0);
  const accepted = bridge.act({ type: "end" });
  m.dom.window.document.querySelector('[role="alertdialog"] button').click(); await accepted;
  assert.deepEqual(m.calls[0].arguments.action, { type: "end", confirmed: true });
  m.dom.window.close();
});
test("a workflow graph is converted for the shared renderer without exposing server actions", async () => {
  const m = setup(); const graphs = [];
  const bridge = await connectMcpApp(m.app, { ...m.env, renderGraph: graph => graphs.push(graph) });
  bridge.receive({ content: [{ type: "text", text: JSON.stringify({ graph: { title: "Learning graph", nodes: [{ id: "c", type: "concept", state: "current", label: "Concept" }], edges: [], focus: "c" } }) }] });
  assert.equal(graphs[0].elements.nodes[0].data.label, "Concept");
  assert.equal(graphs[0].locale, "en");
  m.dom.window.close();
});

test("the course picker opens only the selected course and native runs are explained", async () => {
  const requests = [];
  const m = setup({ callServerTool: async request => {
    requests.push(request);
    return request.name === "list_lessons"
      ? { content: [{ type: "text", text: JSON.stringify({ lessons: [{ title: "Selected course", bundle_ref: "selected/lesson.json" }] }) }] }
      : { structuredContent: { panel: { ...initial, lesson_title: "Selected course", session_id: "selected-session" } } };
  } });
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: { ...initial, actions: [...initial.actions, "pickCourse"] } } });
  await bridge.act({ type: "run" });
  assert.match(m.dom.window.document.body.textContent, /VS Code terminal/);
  assert.equal(requests.length, 0);
  await bridge.act({ type: "pickCourse" });
  assert.equal(requests.length, 1);
  m.dom.window.document.querySelector(".course-picker button").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[1].name, "open_lesson_panel");
  assert.equal(requests[1].arguments.bundle_ref, "selected/lesson.json");
  assert.equal(m.dom.window.document.querySelector(".course-picker"), null);
  m.dom.window.close();
});

test("graph:null clears the previous graph, and node taps show a local label", async () => {
  const m = setup(); const graph = m.dom.window.document.createElement("div"); graph.id = "graph"; m.dom.window.document.body.append(graph);
  const bridge = await connectMcpApp(m.app, { ...m.env, renderGraph: () => { graph.textContent = "Old graph"; } });
  bridge.receive({ structuredContent: { graph: { nodes: [], edges: [] } } });
  assert.equal(graph.textContent, "Old graph");
  bridge.receive({ structuredContent: { graph: null } });
  assert.notEqual(graph.textContent, "Old graph");
  await bridge.act({ type: "nodeClick", id: "node", label: "Concept label" });
  assert.equal(m.dom.window.document.querySelector("#graph-node-details").textContent, "Concept label");
  assert.equal(m.calls.length, 0);
  m.dom.window.close();
});

test("late scientific script loading repaints the graph and leaves a cleared graph empty", async () => {
  const m = setup(); let paints = 0;
  const bridge = await connectMcpApp(m.app, { ...m.env, renderGraph: () => { paints++; } });
  bridge.receive({ structuredContent: { graph: { nodes: [], edges: [] } } });
  const before = paints;
  m.dom.window.dispatchEvent(new m.dom.window.Event("load"));
  assert.equal(paints, before + 1);
  bridge.receive({ structuredContent: { graph: null } });
  m.dom.window.dispatchEvent(new m.dom.window.Event("load"));
  assert.equal(paints, before + 1);
  m.dom.window.close();
});
