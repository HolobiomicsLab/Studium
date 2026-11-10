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
  m.dom.window.document.querySelector('[role="alertdialog"] button').click(); await cancelled;
  assert.equal(m.calls.length, 0);
  const accepted = bridge.act({ type: "end" });
  m.dom.window.document.querySelector('[role="alertdialog"] button:last-child').click(); await accepted;
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
// INT-STUDIUM-058: the server now writes version 2 of the view; this reader accepts both versions.
test("a version-2 tool result renders, and a view of an unknown version is ignored", async () => {
  const m = setup();
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: { ...initial, schema: "studium/panel-view/3" } } });
  assert.doesNotMatch(m.dom.window.document.body.textContent, /Introduction/);
  bridge.receive({ structuredContent: { panel: { ...initial, schema: "studium/panel-view/2", ...{ orientation: { step: { index: 1, total: 2 }, reviews_due: 0, waiting: "read" }, status_line: "Lesson · step 1/2 · to read", voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } }, help: { rungs: [{ kind: "reread", available: true }] }, prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] } } } } });
  assert.match(m.dom.window.document.body.textContent, /Introduction/);
  m.dom.window.close();
});
// INT-STUDIUM-058, task 2.6: the bridge carries the ask action and the display delay the renderer measured.
test("ask goes through, and the display delay rides beside the action as client_ms", async () => {
  const asking = { ...initial, actions: [...initial.actions, "ask"] };
  const calls = [];
  const m = setup({ callServerTool: async request => { calls.push(request); return { structuredContent: { panel: asking } }; } });
  m.calls = calls;
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: asking } });
  await bridge.act({ type: "ask" }, { client_ms: 42 });
  assert.deepEqual(m.calls[0], { name: "panel_action", arguments: { session_id: "one", action: { type: "ask" }, client_ms: 42 } });
  await bridge.act({ type: "ask" });
  assert.deepEqual(m.calls[1], { name: "panel_action", arguments: { session_id: "one", action: { type: "ask" } } });
  await bridge.act({ type: "ask" }, { client_ms: -3 }); // not a delay: left out
  assert.deepEqual(m.calls[2], { name: "panel_action", arguments: { session_id: "one", action: { type: "ask" } } });
  m.dom.window.close();
});
// INT-STUDIUM-058, task 4.3: the bridge carries the three actions of the concept map, and still no unknown one.
test("the map's actions go through: open, close and contest", async () => {
  const mapped = { ...initial, actions: [...initial.actions, "openMap", "closeMap", "contest"] };
  const calls = [];
  const m = setup({ callServerTool: async request => { calls.push(request); return { structuredContent: { panel: mapped } }; } });
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: mapped } });
  const actions = [{ type: "openMap" }, { type: "contest", concept_id: "c1", claim: "known" }, { type: "closeMap" }];
  for (const action of actions) await bridge.act(action);
  assert.deepEqual(calls.map(call => call.arguments.action), actions);
  await bridge.act({ type: "drawMap" });
  assert.equal(calls.length, 3);
  m.dom.window.close();
});
// INT-STUDIUM-058, task 3.3: the panel keeps the agent informed and hands it a question.
const BRIEF = { session_id: "one", cursor: 1, status_line: "Lesson · step 2/2", since_last: [{ scene_id: "intro", act: "read", lane: "fast" }], since_last_count: 1, rules: ["r1", "r2", "r3"] };
/** A host that takes context updates and messages; `events` keeps the order of everything it received. */
function informedHost(options = {}) {
  const events = [];
  const asking = { ...initial, actions: [...initial.actions, "ask"] };
  const m = setup({
    getHostCapabilities: () => ({ updateModelContext: { text: {} }, message: { text: {} }, ...options.capabilities }),
    updateModelContext: async params => { events.push(["context", params]); return {}; },
    sendMessage: async params => { events.push(["message", params]); return options.messageResult ?? {}; },
    callServerTool: async request => {
      events.push(["tool", request.name, request.arguments]);
      if (request.name === "get_companion_brief") return options.briefResult ?? { content: [{ type: "text", text: JSON.stringify({ brief: BRIEF }) }] };
      return { structuredContent: { panel: asking } };
    },
  });
  return { ...m, events, asking };
}
test("after each panel action the model's context gets the brief, read without moving its cursor", async () => {
  const m = informedHost();
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: m.asking } });
  await bridge.act({ type: "respond", input: { kind: "ack" } });
  assert.deepEqual(m.events.map(event => event.slice(0, 2)), [["tool", "panel_action"], ["tool", "get_companion_brief"], ["context", m.events[2][1]]]);
  assert.deepEqual(m.events[1][2], { session_id: "one", peek: true });
  const context = m.events[2][1];
  assert.equal(context.content.length, 1);
  assert.equal(context.content[0].type, "text");
  assert.match(context.content[0].text, /^Studium/);
  assert.deepEqual(JSON.parse(context.content[0].text.split("\n").at(-1)), { brief: BRIEF });
  m.dom.window.close();
});
test("a host that takes no context update is asked for no brief, and a brief that fails leaves the panel as it is", async () => {
  const silent = informedHost({ capabilities: { updateModelContext: undefined } });
  const bridge = await connectMcpApp(silent.app, silent.env);
  bridge.receive({ structuredContent: { panel: silent.asking } });
  await bridge.act({ type: "respond", input: { kind: "ack" } });
  assert.deepEqual(silent.events.map(event => event[1]), ["panel_action"]);
  silent.dom.window.close();

  const failing = informedHost({ briefResult: { isError: true, content: [{ type: "text", text: "session not found" }] } });
  const second = await connectMcpApp(failing.app, failing.env);
  second.receive({ structuredContent: { panel: failing.asking } });
  await second.act({ type: "respond", input: { kind: "ack" } });
  assert.deepEqual(failing.events.map(event => event[0]), ["tool", "tool"]);  // no context update
  assert.doesNotMatch(failing.dom.window.document.body.textContent, /session not found/);
  assert.match(failing.dom.window.document.body.textContent, /Introduction/);
  failing.dom.window.close();
});
test("« ask a question » takes the learner's words and sends them to the host's conversation, after the brief", async () => {
  const m = informedHost();
  const doc = m.dom.window.document;
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: m.asking } });
  const asked = bridge.act({ type: "ask" });
  await new Promise(resolve => setTimeout(resolve, 0));
  const form = doc.querySelector("form.ask-question");
  assert.ok(form, "a form takes the question");
  assert.equal(m.events.length, 0);  // nothing is sent before the learner writes
  const field = form.querySelector("textarea");
  assert.ok(field.labels.length === 1 && field.labels[0].textContent.length > 0);
  form.querySelector('button[type="submit"]').click();  // empty: nothing happens, the form stays
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(doc.querySelector("form.ask-question"));
  assert.equal(m.events.length, 0);
  field.value = "  Pourquoi 30 neutrons ?  ";
  form.querySelector('button[type="submit"]').click();
  await asked;
  assert.equal(doc.querySelector("form.ask-question"), null);
  assert.deepEqual(m.events.map(event => event.slice(0, 2)), [
    ["tool", "get_companion_brief"], ["context", m.events[1][1]], ["message", m.events[2][1]], ["tool", "panel_action"]]);
  assert.deepEqual(m.events[0][2], { session_id: "one" });  // the agent is told now: the cursor moves
  assert.deepEqual(m.events[2][1], { role: "user", content: [{ type: "text", text: "Pourquoi 30 neutrons ?" }] });
  assert.deepEqual(m.events[3][2], { session_id: "one", action: { type: "ask", text: "Pourquoi 30 neutrons ?" } });
  m.dom.window.close();
});
test("a question the learner gives up sends nothing; one that already has its words needs no form", async () => {
  const m = informedHost();
  const doc = m.dom.window.document;
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: m.asking } });
  const cancelled = bridge.act({ type: "ask" });
  await new Promise(resolve => setTimeout(resolve, 0));
  doc.querySelector("form.ask-question textarea").value = "Peu importe";
  doc.querySelector('form.ask-question button[type="button"]').click();
  await cancelled;
  assert.equal(doc.querySelector("form.ask-question"), null);
  assert.equal(m.events.length, 0);
  await bridge.act({ type: "ask", text: "Explique-moi cet écran." });  // the « explanation » rung
  assert.equal(doc.querySelector("form.ask-question"), null);
  assert.deepEqual(m.events.find(event => event[0] === "message")[1].content[0].text, "Explique-moi cet écran.");
  assert.deepEqual(m.events.at(-1).slice(1), ["panel_action", { session_id: "one", action: { type: "ask", text: "Explique-moi cet écran." } }]);
  m.dom.window.close();
});
test("a host that refuses the message still gets the ask action, whose notice sends the learner to the conversation", async () => {
  const refused = informedHost({ messageResult: { isError: true } });
  const bridge = await connectMcpApp(refused.app, refused.env);
  bridge.receive({ structuredContent: { panel: refused.asking } });
  await bridge.act({ type: "ask", text: "Une question" });
  assert.deepEqual(refused.events.at(-1).slice(1), ["panel_action", { session_id: "one", action: { type: "ask", text: "Une question" } }]);
  refused.dom.window.close();

  const mute = informedHost({ capabilities: { message: undefined } });  // no message support: no form, the action goes straight
  const second = await connectMcpApp(mute.app, mute.env);
  second.receive({ structuredContent: { panel: mute.asking } });
  await second.act({ type: "ask" });
  assert.equal(mute.dom.window.document.querySelector("form.ask-question"), null);
  assert.deepEqual(mute.events[0].slice(1), ["panel_action", { session_id: "one", action: { type: "ask" } }]);
  assert.equal(mute.events.some(event => event[0] === "message"), false);
  mute.dom.window.close();
});

// Walkthrough 2026-11-07: after a server restart, an action on the old session_id fails with « session not found ».
// The panel says so; its reopen button opens the same lesson again for the same learner, once, on the learner's click.
test("a lost session shows the notice; reopen sends open_lesson_panel with the view's bundle_ref and learner_id", async () => {
  const requests = [];
  const lost = { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "session not found: one (the server may have restarted, or the session was closed): call start_lesson_session…" }) }] };
  const m = setup({
    getHostContext: () => ({ locale: "en-US" }),
    callServerTool: async request => {
      requests.push(request);
      if (request.name === "panel_action") return lost;
      return { structuredContent: { panel: { ...initial, session_id: "two", scene: { ...initial.scene, title: "Resumed scene" } } } };
    },
  });
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: { ...initial, surface: { rank: 3, kind: "panel", available: ["text", "panel"] } } } });
  await bridge.act({ type: "hint" });
  const doc = m.dom.window.document;
  assert.ok(doc.querySelector(".session-lost"), "the notice replaces the scene");
  assert.match(doc.querySelector(".session-lost").textContent, /Session lost/);
  assert.equal(requests.length, 1, "nothing is retried on its own");
  doc.querySelector(".session-lost .reopen-lesson").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests[1], { name: "open_lesson_panel", arguments: { bundle_ref: "course", learner_id: "learner", locale: "en", surface: "panel" } });
  assert.match(doc.body.textContent, /Resumed scene/);
  assert.equal(doc.querySelector(".session-lost"), null);
  m.dom.window.close();
});

// INT-STUDIUM-058 § 2.1: a panel shown for a conversation or forms surface draws a notice; its « Play here »
// asks the server for the panel on the same session (open_lesson_panel renegotiates when it is given a
// surface), on the learner's click only.
test("« Play here » on an off-surface notice sends open_lesson_panel with the session and surface: \"panel\"", async () => {
  const requests = [];
  const m = setup({
    getHostContext: () => ({ locale: "en-US" }),
    callServerTool: async request => {
      requests.push(request);
      return { structuredContent: { panel: { ...initial, schema: "studium/panel-view/2", surface: { rank: 3, kind: "panel", available: ["text", "panel"] }, scene: { ...initial.scene, title: "Played here" } } } };
    },
  });
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: { ...initial, schema: "studium/panel-view/2", surface: { rank: 1, kind: "text", available: ["text", "panel"] } } } });
  const doc = m.dom.window.document;
  assert.match(doc.querySelector(".surface-elsewhere").textContent, /This lesson is played in the conversation/);
  assert.equal(doc.querySelector(".scene-title"), null);
  assert.equal(requests.length, 0, "nothing is sent on its own");
  doc.querySelector(".surface-elsewhere .play-here").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(requests, [{ name: "open_lesson_panel", arguments: { session_id: "one", bundle_ref: "course", learner_id: "learner", locale: "en", surface: "panel" } }]);
  assert.match(doc.body.textContent, /Played here/);
  assert.equal(doc.querySelector(".surface-elsewhere"), null);
  m.dom.window.close();
});

// Panel audit 2026-11-10, A1 and C3: every action type the shared list names leaves the bridge for the server (or for the
// host's own picker and confirmation); an action the view does not offer is refused without asking to try again.
const { PANEL_ACTION_TYPES } = await import("../../../packages/lesson-panel/src/transport.ts");
const SAMPLE_ACTIONS = {
  respond: { input: { kind: "ack" } }, turn: { text: "t" }, hint: {}, rateRecall: { sceneId: "intro", grade: "good" }, reviewNow: {},
  restartLesson: {}, end: {}, pickCourse: {}, ask: { text: "q" }, setAttention: { level: "quiet" }, setLanguage: { presentation_language: "fr" },
  replan: { minutes: 10 }, openMap: {}, closeMap: {}, contest: { concept_id: "c", claim: "known" }, prompt: { id: "p", outcome: "dismiss" },
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test("every action type an adapter must transport leaves the MCP App bridge", async () => {
  assert.ok(PANEL_ACTION_TYPES.length >= 16);
  for (const type of PANEL_ACTION_TYPES) {
    assert.ok(SAMPLE_ACTIONS[type], `the test has a sample ${type} action`);
    const offered = { ...initial, actions: [...PANEL_ACTION_TYPES] };
    const requests = [];
    const m = setup({ callServerTool: async request => { requests.push(request); return request.name === "list_lessons" ? { structuredContent: { lessons: [] } } : { structuredContent: { panel: offered } }; } });
    const bridge = await connectMcpApp(m.app, m.env);
    bridge.receive({ structuredContent: { panel: offered } });
    const acting = bridge.act({ type, ...SAMPLE_ACTIONS[type] });
    if (type === "end") {
      await tick();
      [...m.dom.window.document.querySelectorAll('[role="alertdialog"] button')].find(button => /Erase/.test(button.textContent)).click();
    }
    await acting;
    const expected = type === "pickCourse" ? "list_lessons" : "panel_action";
    assert.ok(requests.some(request => request.name === expected && (expected !== "panel_action" || request.arguments.action.type === type)), `${type} reaches the server`);
    assert.doesNotMatch(m.dom.window.document.body.textContent, /Action failed/, `${type} does not fail in the bridge`);
    m.dom.window.close();
  }
});
test("an action the view does not offer is refused without asking to try again", async () => {
  const m = setup(); const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: initial } });
  await bridge.act({ type: "setAttention", level: "quiet" });
  assert.equal(m.calls.length, 0);
  const status = m.dom.window.document.querySelector("#action-status").textContent;
  assert.match(status, /not available/);
  assert.doesNotMatch(status, /Try again/);
  m.dom.window.close();
});

// Panel audit 2026-11-10, A7: the erase confirmation is drawn in the panel, named, « Cancel » first, the destructive
// button marked; Escape cancels and the « ⋯ » menu takes the focus back.
test("the erase confirmation is a named dialog in the panel; Escape cancels and the menu takes the focus back", async () => {
  const m = setup(); const doc = m.dom.window.document;
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: initial } });
  const asked = bridge.act({ type: "end" });
  await tick();
  const dialog = doc.querySelector('#pane [role="alertdialog"]');
  assert.ok(dialog, "the dialog is inside the panel");
  const title = doc.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
  assert.ok(title && title.textContent.trim().length > 0, "the dialog is named by its title");
  const buttons = [...dialog.querySelectorAll("button")];
  assert.equal(buttons[0].textContent, "Cancel");
  assert.equal(buttons.at(-1).getAttribute("data-destructive"), "true");
  assert.ok(buttons.every(button => button.classList.contains("st-button")), "the design system's buttons");
  assert.equal(doc.activeElement, buttons[0]);
  dialog.dispatchEvent(new m.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await asked;
  assert.equal(doc.querySelector('[role="alertdialog"]'), null);
  assert.equal(m.calls.length, 0);
  assert.equal(doc.activeElement, doc.querySelector(".pane-menu summary"));
  m.dom.window.close();
});

// Panel audit 2026-11-10, A8: the course picker is a list in the panel, with what the catalogue says of each course.
test("the course picker is a styled list in the panel, with each course's language and approval", async () => {
  const lessons = [{ title: "Atomistique", bundle_ref: "a.json", language: "fr", validated: true, scene_count: 32 }, { title: "Kinetics", bundle_ref: "k.json", language: "en", validated: false }];
  const m = setup({ callServerTool: async request => (request.name === "list_lessons" ? { structuredContent: { lessons } } : { structuredContent: { panel: initial } }) });
  const doc = m.dom.window.document;
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: { ...initial, actions: [...initial.actions, "pickCourse"] } } });
  await bridge.act({ type: "pickCourse" });
  const picker = doc.querySelector("#pane .course-picker");
  assert.ok(picker, "the picker is inside the panel");
  const items = [...picker.querySelectorAll("li")];
  assert.equal(items.length, 2);
  assert.match(items[0].textContent, /Atomistique/);
  assert.match(items[0].textContent, /Français/);
  assert.match(items[0].textContent, /approved by a teacher/);
  assert.match(items[1].textContent, /English/);
  assert.doesNotMatch(items[1].textContent, /approved/);
  assert.ok([...picker.querySelectorAll("button")].every(button => button.classList.contains("st-button")), "no bare browser button");
  m.dom.window.close();
});

// Panel audit 2026-11-10, A9 and C4: « Ask a question » opens its field in place, in the help ladder.
test("the question form opens inside the help ladder", async () => {
  const m = informedHost();
  const doc = m.dom.window.document;
  const helped = { ...m.asking, schema: "studium/panel-view/2", orientation: { step: { index: 1, total: 2 }, reviews_due: 0, waiting: "read" }, status_line: "Lesson · step 1/2", voices: { scene: { kind: "author", name: null, reviewed: true, drafted_by: "teacher" } }, help: { rungs: [{ kind: "reread", available: true }] }, prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["panel"] } };
  const bridge = await connectMcpApp(m.app, m.env);
  bridge.receive({ structuredContent: { panel: helped } });
  const asked = bridge.act({ type: "ask" });
  await tick();
  const form = doc.querySelector("form.ask-question");
  assert.ok(form && form.closest("#pane .help-ladder"), "the form is in the help ladder");
  form.querySelector('button[type="button"]').click();
  await asked;
  m.dom.window.close();
});
// Panel audit 2026-11-10, A9: the server says « your question has gone to the conversation » when the ask action
// carries words; a host that takes no message never sent them, so the bridge sends the hand-over without words.
test("a host that takes no message sends the ask action without words", async () => {
  const mute = informedHost({ capabilities: { message: undefined } });
  const bridge = await connectMcpApp(mute.app, mute.env);
  bridge.receive({ structuredContent: { panel: mute.asking } });
  await bridge.act({ type: "ask", text: "Explique-moi cet écran." });
  assert.deepEqual(mute.events.find(event => event[1] === "panel_action").slice(1), ["panel_action", { session_id: "one", action: { type: "ask" } }]);
  mute.dom.window.close();
});
