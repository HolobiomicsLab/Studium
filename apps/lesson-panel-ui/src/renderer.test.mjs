// Full-state replay must retain effects without duplicating conversation turns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { JSDOM } = require("jsdom");
const pane = new URL("artifact-pane.js", import.meta.url);
const view = (extra = {}) => ({ schema: "studium/panel-view/1", kind: "scene", session_id: "one", learner_id: "learner", bundle_ref: "course", lesson_title: "Test", locale: "en", strings: {}, progress: { index: 1, total: 2 }, scene: { id: "scene", type: "discussion", title: "Discussion", prompt: "Explain your reasoning" }, scene_assets: [], reviewDue: [], calibration: [], mastery: {}, actions: ["turn", "hint"], ...extra });
function mount() {
  const dom = new JSDOM('<!doctype html><html><body><div id="pane"></div></body></html>', { runScripts: "outside-only" });
  dom.window.eval(readFileSync(pane, "utf8").replace(/export \{ renderView \};?\s*$/, ""));
  return dom;
}
test("a fresh full view paints its scene, hint and tutor reply; replay is idempotent", () => {
  const dom = mount();
  const state = view({ hint: { hint: "Try the definition", remaining: 1 }, turn_result: { reasoning: null, tutor: { text: "Consider an example" } } });
  dom.window.renderView(state);
  assert.match(dom.window.document.body.textContent, /Discussion/);
  assert.match(dom.window.document.body.textContent, /Try the definition/);
  assert.match(dom.window.document.body.textContent, /Consider an example/);
  dom.window.renderView(state);
  assert.equal(dom.window.document.querySelectorAll(".turn-tutor").length, 1);
  assert.match(dom.window.document.querySelector(".turn-tutor").textContent, /Consider an example/);
  dom.window.close();
});
test("a pending view disables actions, settling it restores the live scene", () => {
  const dom = mount();
  dom.window.renderView(view({ pending: "Working" }));
  assert.equal(dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "true");
  dom.window.renderView(view());
  assert.notEqual(dom.window.document.querySelector("#pane").getAttribute("aria-busy"), "true");
  dom.window.close();
});

test("the legacy envelope carries a complete view without replaying its effects twice", () => {
  const dom = mount();
  const state = view({ scene: { id: "discussion", type: "discussion", title: "Reason together", prompt: "Explain" }, turn_result: { reasoning: null, tutor: { text: "A single tutor reply" } } });
  const envelope = { type: "turn_result", ...state.turn_result, view: state };
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: envelope }));
  assert.match(dom.window.document.body.textContent, /Reason together/);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: envelope }));
  assert.equal(dom.window.document.querySelectorAll(".turn-tutor").length, 1);
  assert.match(dom.window.document.querySelector(".turn-tutor").textContent, /A single tutor reply/);
  dom.window.close();
});
