// The browser player's page (bridge-browser.js) in a real DOM: its token, its list of lessons, its calls,
// and the views it draws, which must be the VS Code pane's for the same view (honesty notices included).
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const bundle = async (file) => {
  const compiled = await build({ entryPoints: [new URL(file, import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
};
const { connectMcpApp } = await bundle("bridge-mcp-app.js");
const { startBrowserPlayer, TOKEN_KEY, SESSION_KEY } = await bundle("bridge-browser.js");
const { browserPhrases } = await bundle("../../../packages/lesson-panel/src/phrases.ts");
const pane = readFileSync(new URL("artifact-pane.js", import.meta.url), "utf8").replace(/export \{ renderView \};?\s*$/, "");
const TOKEN = "t".repeat(64);
const ORIGIN = "http://127.0.0.1:5555";

const fr = browserPhrases("fr");
const scene = { id: "s1-quiz-fer", type: "quiz", title: "Quiz : l'atome de fer", question: "Combien de neutrons ?", choices: [{ id: "a", text: "82" }, { id: "b", text: "30" }] };
const VIEW = {
  schema: "studium/panel-view/2", kind: "scene", session_id: "session-1", learner_id: "anonymous", bundle_ref: "atomistique-l1/lesson.json",
  lesson_title: "Atomistique L1", locale: "fr", strings: fr, progress: { index: 3, total: 32 }, scene, scene_assets: [], modalityPreference: "balanced",
  reviewDue: [], calibration: [], mastery: {}, actions: ["respond", "hint", "end", "pickCourse", "setLanguage", "setAttention", "replan", "openMap"],
  authoring: { mode: "teacher", author_is_learner: false, validated: true, judge: false, notice: null, drafted_by: "teacher" },
  orientation: { step: { index: 3, total: 32 }, minutes_left: 74, reviews_due: 0, waiting: "answer" },
  status_line: "Atomistique L1 · étape 3/32 · 74 min · à toi de répondre",
  voices: { scene: { kind: "author", name: "beta-testeur", reviewed: true, drafted_by: "teacher" } },
  help: { rungs: [{ kind: "reread", available: true }, { kind: "hint", available: true, cost: "un indice réduit le crédit de cette réponse" },
    { kind: "explain", available: false, why_not: "essaie d'abord de répondre" }, { kind: "reference", available: false, why_not: "la référence s'affiche après ta réponse" }] },
  prompts: [], attention: "normal", surface: { rank: 3, kind: "pane", available: ["text", "pane"] },
};
const ANSWERED = { ...VIEW, scene: { ...scene, id: "s2-concept", type: "concept", title: "Les nombres quantiques", markdown: "Quatre nombres." },
  verdict: { scene_id: "s1-quiz-fer", graded: true, correct: true, assessed_by: "key", feedback: "Oui : 56 − 26 = 30." },
  voices: { scene: VIEW.voices.scene, verdict: { kind: "key" } } };
const LESSONS = { lessons: [
  { bundle_ref: "atomistique-l1/lesson.json", title: "Atomistique L1", scene_count: 32, validated: true, status: { state: "in_progress", scenes_completed: 3, total_scenes: 32 } },
  { bundle_ref: "capsule-demo/lesson.json", title: "Capsule", scene_count: 4, validated: false, status: { state: "completed", scenes_completed: 4, total_scenes: 4 } },
] };

/** A page as the server serves it, with a recorder in place of the network. */
function page({ hash = `#token=${TOKEN}`, reply, stored = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><main id="pane"></main><div id="pane-live"></div></body></html>', { url: `${ORIGIN}/play${hash}`, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(pane);
  Object.defineProperty(dom.window.navigator, "language", { value: "fr-FR", configurable: true });
  for (const [key, value] of Object.entries(stored)) dom.window.sessionStorage.setItem(key, value);
  const calls = [];
  dom.window.fetch = async (url, init) => {
    const call = { url: String(url), ...init, body: JSON.parse(init.body) };
    calls.push(call);
    const [status, body] = await (reply ?? defaultReply)(call.url.split("/").pop(), call.body.arguments);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const start = () => startBrowserPlayer({ window: dom.window, document: dom.window.document, connectMcpApp, renderView: dom.window.renderView });
  return { dom, doc: dom.window.document, calls, start };
}
async function defaultReply(name) {
  if (name === "list_lessons") return [200, { content: [{ type: "text", text: JSON.stringify(LESSONS) }] }];
  if (name === "panel_action") return [200, { structuredContent: { panel: ANSWERED } }];
  return [200, { structuredContent: { panel: VIEW } }];
}
const flat = (value) => value.replace(/\s+/g, " ").trim(); // French typesetting puts no-break spaces before « : »
const text = (node) => (node ? flat(node.textContent) : null);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test("the token leaves the address bar for this tab's storage, and every call carries it to the same origin only", async () => {
  const p = page();
  await p.start();
  assert.equal(p.dom.window.location.href, `${ORIGIN}/play`);
  assert.equal(p.dom.window.sessionStorage.getItem(TOKEN_KEY), TOKEN);
  assert.equal(p.dom.window.localStorage.length, 0);
  assert.equal(p.doc.cookie, "");
  assert.deepEqual(p.calls.map(call => [call.url, call.method, call.credentials, call.headers.authorization, call.headers["content-type"]]),
    [["/play/api/tools/list_lessons", "POST", "omit", `Bearer ${TOKEN}`, "application/json"]]);
  p.dom.window.close();
});

test("without a token the page says where the address is, and calls nothing", async () => {
  const p = page({ hash: "" });
  await p.start();
  assert.equal(text(p.doc.querySelector(".player-notice")), flat(fr.player_no_token));
  assert.equal(p.calls.length, 0);
  p.dom.window.close();
});

test("the list shows each lesson with its steps, approval and progress, and opens the one chosen", async () => {
  const p = page();
  await p.start();
  assert.equal(text(p.doc.querySelector("h1")), "Leçons Studium");
  const choices = [...p.doc.querySelectorAll(".course-choice")];
  assert.deepEqual(choices.map(choice => [text(choice.querySelector(".course-choice-title")), text(choice.querySelector(".course-choice-facts"))]), [
    ["Atomistique L1", "32 étapes · validée par un enseignant · 3 étapes sur 32 faites"],
    ["Capsule", "4 étapes · terminée"],
  ]);
  choices[0].click(); await settle(); await settle();
  assert.deepEqual(p.calls[1].body, { arguments: { bundle_ref: "atomistique-l1/lesson.json", locale: "fr" } });
  assert.match(text(p.doc.querySelector(".scene-title")), /atome de fer/);
  assert.equal(p.dom.window.sessionStorage.getItem(SESSION_KEY), "session-1");
  p.dom.window.close();
});

test("a lesson shipped with Studium is listed after the learner's own and labelled; alone, it replaces the empty notice", async () => {
  const demo = { bundle_ref: "discover-studium-fr/lesson.json", title: "Découvrir Studium", scene_count: 12, validated: false, source: "shipped", status: { state: "not_started" } };
  const withBoth = page({ reply: async (name) => name === "list_lessons"
    ? [200, { content: [{ type: "text", text: JSON.stringify({ ...LESSONS, shipped_lessons: [demo] }) }] }] : defaultReply(name) });
  await withBoth.start();
  const rows = [...withBoth.doc.querySelectorAll(".course-choice")].map(choice => [text(choice.querySelector(".course-choice-title")), text(choice.querySelector(".course-choice-facts"))]);
  assert.deepEqual(rows[2], ["Découvrir Studium", "12 étapes · " + flat(fr.player_shipped)]);
  withBoth.dom.window.close();
  const alone = page({ reply: async (name) => name === "list_lessons"
    ? [200, { content: [{ type: "text", text: JSON.stringify({ lessons: [], shipped_lessons: [demo] }) }] }] : defaultReply(name) });
  await alone.start();
  assert.equal(alone.doc.querySelector(".course-choice-empty, .course-picker-empty"), null);
  const only = [...alone.doc.querySelectorAll(".course-choice")];
  assert.equal(only.length, 1);
  only[0].click(); await settle(); await settle();
  assert.deepEqual(alone.calls[1].body, { arguments: { bundle_ref: "discover-studium-fr/lesson.json", locale: "fr" } });
  alone.dom.window.close();
});

test("a reload resumes the session of this tab instead of listing the lessons", async () => {
  const p = page({ hash: "", stored: { [TOKEN_KEY]: TOKEN, [SESSION_KEY]: "session-1" } });
  await p.start();
  assert.deepEqual(p.calls.map(call => [call.url, call.body.arguments]), [["/play/api/tools/get_panel_view", { session_id: "session-1" }]]);
  assert.match(text(p.doc.querySelector(".scene-title")), /atome de fer/);
  p.dom.window.close();
});

test("a server that restarted or stopped is named as such, not as a failed action", async () => {
  const restarted = page({ reply: async () => [401, { error: "A valid token is required", code: "unauthorized" }] });
  await restarted.start();
  assert.equal(text(restarted.doc.querySelector(".player-notice")), flat(fr.player_token_rejected));
  restarted.dom.window.close();
  const stopped = page({ reply: async () => { throw new TypeError("Failed to fetch"); } });
  stopped.dom.window.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await stopped.start();
  assert.equal(text(stopped.doc.querySelector(".player-notice")), flat(fr.player_unreachable));
  stopped.dom.window.close();
});

test("a view is drawn exactly as the VS Code pane draws it, honesty notices included", async () => {
  for (const view of [VIEW, ANSWERED]) {
    const p = page({ hash: "", stored: { [TOKEN_KEY]: TOKEN, [SESSION_KEY]: "session-1" }, reply: async () => [200, { structuredContent: { panel: view } }] });
    await p.start();
    // The VS Code pane: the extension posts the server's view to the same renderer (bridge-vscode.js).
    const vscode = new JSDOM('<!doctype html><html><body><main id="pane"></main><div id="pane-live"></div></body></html>', { runScripts: "outside-only", pretendToBeVisual: true });
    vscode.window.eval(pane);
    vscode.window.renderView(view);
    assert.equal(p.doc.getElementById("pane").innerHTML, vscode.window.document.getElementById("pane").innerHTML);
    assert.equal(text(p.doc.querySelector(".voice-scene")), text(vscode.window.document.querySelector(".voice-scene")));
    if (view === VIEW) assert.equal(text(p.doc.querySelector(".voice-scene")), "Leçon validée par beta-testeur");
    if (view === ANSWERED) assert.equal(text(p.doc.querySelector(".voice-verdict")), text(vscode.window.document.querySelector(".voice-verdict")));
    if (view === ANSWERED) assert.ok(text(p.doc.querySelector(".voice-verdict")));
    p.dom.window.close(); vscode.window.close();
  }
});

test("an answer goes to the server through panel_action, with the scene on screen", async () => {
  const p = page({ hash: "", stored: { [TOKEN_KEY]: TOKEN, [SESSION_KEY]: "session-1" } });
  const bridge = await p.start();
  await bridge.act({ type: "respond", input: { kind: "quiz_choice", choiceId: "b" }, expected_scene_id: "s1-quiz-fer" });
  const sent = p.calls.at(-1);
  assert.equal(sent.url, "/play/api/tools/panel_action");
  assert.deepEqual(sent.body.arguments, { session_id: "session-1", action: { type: "respond", input: { kind: "quiz_choice", choiceId: "b" }, expected_scene_id: "s1-quiz-fer" } });
  assert.match(text(p.doc.getElementById("pane")), /56 − 26 = 30/);
  p.dom.window.close();
});
