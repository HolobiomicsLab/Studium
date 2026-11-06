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
// INT-STUDIUM-058, task 2.6: what the panel shows of a version-2 view — where the learner is, who speaks,
// which help is open — with every action reachable from the keyboard, and the display delay of each
// view joined to the next action.
const V2 = {
  schema: "studium/panel-view/2",
  orientation: { step: { index: 1, total: 2 }, reviews_due: 0, waiting: "answer" },
  status_line: "Test · step 1/2 · 3 min · your answer",
  voices: { scene: { kind: "author", name: "Prof. Test", reviewed: true, drafted_by: "teacher" } },
  help: { rungs: [
    { kind: "reread", available: true },
    { kind: "hint", available: true, cost: "a hint lowers the credit of this answer" },
    { kind: "explain", available: false, why_not: "try an answer first" },
    { kind: "reference", available: false, why_not: "the reference shows after your answer" },
  ] },
  prompts: [], attention: "normal", surface: { rank: 3, kind: "panel", available: ["text", "panel"] },
};
const QUIZ = { id: "quiz", type: "quiz", title: "A question", question: "Which one?", choices: [{ id: "a", text: "First" }, { id: "b", text: "Second" }] };
const WORDS = {
  pane_hint: "Hint", pane_help_heading: "Help", pane_help_reread: "Read again", pane_help_explain: "Explanation",
  pane_help_reference: "Reference", pane_help_explain_question: "Explain this screen to me.", pane_ask: "Ask a question",
  pane_voice_validated_by: "Lesson validated by {name}", pane_voice_key: "Assessed by the author's key",
  pane_progress: "Step {position} of {total}", pane_validate: "Submit", pane_continue: "Continue",
};
const quizV2 = (extra = {}) => view({ ...V2, strings: WORDS, scene: QUIZ, actions: ["respond", "hint", "end", "ask"], ...extra });
/** Mount the renderer with a recorder in place of the host bridge. */
function mountWithSend() {
  const dom = mount();
  const sent = [];
  dom.window.__send = (...args) => { sent.push(args); };
  return { dom, sent, doc: dom.window.document };
}
const text = (node) => (node ? node.textContent.replace(/\s+/g, " ").trim() : null);
/** What the renderer sent, as plain data: its objects belong to the test window, not to this module. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a version-1 view keeps its step label and its own hint button", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(view({ strings: WORDS, scene: QUIZ, actions: ["respond", "hint", "end"] }));
  assert.equal(text(doc.querySelector(".st-progress__label")), "Step 1 of 2");
  assert.ok(doc.querySelector(".hint-button"));
  assert.equal(doc.querySelector(".orientation-line"), null);
  assert.equal(doc.querySelector(".help-ladder"), null);
  assert.equal(doc.querySelector(".voice"), null);
  dom.window.close();
});

test("a version-2 view opens with its orientation line, and says the step once", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(text(doc.querySelector(".orientation-line")), "Test · step 1/2 · 3 min · your answer");
  assert.equal(doc.querySelector(".st-progress__label"), null); // the rail keeps its segments, not a second label
  assert.ok(doc.querySelector(".progress[role=progressbar]"));
  // The orientation line comes before the scene's title.
  const line = doc.querySelector(".orientation-line"), title = doc.querySelector(".scene-title");
  assert.ok(line.compareDocumentPosition(title) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("a version-2 view names the voice of the scene, and the voice of a verdict over its feedback", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(text(doc.querySelector(".voice-scene")), "Lesson validated by Prof. Test");
  assert.equal(doc.querySelector(".voice-verdict"), null);
  dom.window.renderView(quizV2({
    voices: { ...V2.voices, verdict: { kind: "key" } },
    verdict: { scene_id: "earlier", graded: true, correct: true, feedback: "Well done." },
  }));
  const voice = doc.querySelector(".feedback-step .voice-verdict"), card = doc.querySelector(".feedback-card");
  assert.equal(text(voice), "Assessed by the author's key");
  assert.ok(voice.compareDocumentPosition(card) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  dom.window.close();
});

test("the help ladder shows every rung: a closed one with its reason, an open hint with its cost", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  const rungs = [...doc.querySelectorAll(".help-ladder [data-rung]")];
  assert.deepEqual(rungs.map((button) => button.dataset.rung), ["reread", "hint", "explain", "reference"]);
  assert.deepEqual(rungs.map((button) => text(button)), ["Read again", "Hint", "Explanation", "Reference"]);
  const note = (button) => text(doc.getElementById(button.getAttribute("aria-describedby")));
  assert.equal(note(rungs[1]), "a hint lowers the credit of this answer");
  assert.equal(note(rungs[2]), "try an answer first");
  assert.equal(rungs[2].getAttribute("aria-disabled"), "true");
  assert.equal(rungs[1].getAttribute("aria-disabled"), null);
  assert.equal(rungs[2].disabled, false); // still focusable: its reason must be reachable
  assert.equal(doc.querySelector(".hint-button"), null); // one hint control, in the ladder
  assert.equal(text(doc.querySelector(".ask-button")), "Ask a question");

  rungs[2].click(); // closed: nothing is sent, the reason is said
  rungs[3].click();
  assert.deepEqual(plain(sent), []);
  assert.equal(text(doc.querySelector("#action-status")), "the reference shows after your answer");
  rungs[1].click();
  assert.deepEqual(plain(sent[0][0]), { type: "hint" });
  dom.window.close();
});

test("an open explanation and « Ask a question » hand over to the assistant", () => {
  const { dom, doc, sent } = mountWithSend();
  const tried = { rungs: [{ kind: "reread", available: true }, { kind: "explain", available: true }] };
  dom.window.renderView(quizV2({ help: tried }));
  doc.querySelector(".help-ladder [data-rung=explain]").click();
  assert.deepEqual(plain(sent[0][0]), { type: "ask", text: "Explain this screen to me." });
  dom.window.renderView(quizV2({ help: tried, session_id: "two" }));
  doc.querySelector(".ask-button").click();
  assert.deepEqual(plain(sent[1][0]), { type: "ask" });
  // A view that does not offer the action shows no ask button, and an explanation rung with nothing to send.
  dom.window.renderView(quizV2({ help: tried, session_id: "three", actions: ["respond"] }));
  assert.equal(doc.querySelector(".ask-button"), null);
  doc.querySelector(".help-ladder [data-rung=explain]").click();
  assert.equal(sent.length, 2);
  dom.window.close();
});

test("every action of a version-2 scene is reachable from the keyboard, in reading order", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(quizV2());
  doc.querySelector(".choices input").click(); // a choice is picked: « Submit » is enabled
  const focusable = [...doc.querySelectorAll("#pane button, #pane input, #pane textarea, #pane summary, #pane a[href], #pane [tabindex]")]
    .filter((node) => node.getAttribute("tabindex") !== "-1" && !node.disabled);
  for (const node of focusable) {
    const tabindex = node.getAttribute("tabindex");
    assert.ok(tabindex === null || tabindex === "0", `no positive tabindex (${node.outerHTML.slice(0, 80)})`);
  }
  const order = (selector) => {
    const node = doc.querySelector(selector);
    assert.ok(node, `${selector} is in the pane`);
    const index = focusable.indexOf(node);
    assert.ok(index >= 0, `${selector} takes the keyboard focus`);
    return index;
  };
  const sequence = [
    ".choices input[value='0']", ".choices input[value='1']", ".validate",
    "[data-rung=reread]", "[data-rung=hint]", "[data-rung=explain]", "[data-rung=reference]", ".ask-button",
  ].map(order);
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
  order(".pane-menu summary"); // the menu (forget) too
  dom.window.close();
});

test("the delay between an action and the display of its answer is joined to the next action", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  doc.querySelector(".help-ladder [data-rung=hint]").click();
  assert.deepEqual(plain(sent[0]), [{ type: "hint" }]); // nothing to report yet: no action came before
  dom.window.renderView(quizV2({ hint: { hint: "Think of the definition", remaining: 0 } }));
  doc.querySelector(".ask-button").click();
  assert.deepEqual(plain(sent[1][0]), { type: "ask" });
  const meta = sent[1][1];
  assert.ok(Number.isInteger(meta.client_ms) && meta.client_ms >= 0 && meta.client_ms < 60_000, `client_ms ${meta.client_ms}`);
  // Reported once: the action after that one carries the delay of its own predecessor, measured afresh.
  dom.window.renderView(quizV2({ session_id: "two" }));
  doc.querySelector(".ask-button").click();
  assert.ok(Number.isInteger(sent[2][1].client_ms));
  dom.window.renderView(quizV2({ session_id: "three" }));
  dom.window.renderView(quizV2({ session_id: "four" })); // a view nobody asked for reports nothing
  doc.querySelector(".ask-button").click();
  assert.ok(Number.isInteger(sent[3][1].client_ms));
  dom.window.close();
});
