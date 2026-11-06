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

// INT-STUDIUM-058, task 4.3: the concept map in the panel, as a list. Every concept with its state in
// words, the answers behind it, what the state establishes and what it does not, and the claim the
// learner may make; the whole of it reachable from the keyboard.
const MAP_WORDS = {
  ...WORDS,
  pane_map_open: "Concept map", pane_map_close: "Close the map",
  pane_map_state_acquired: "acquired", pane_map_state_to_review: "to review", pane_map_state_current: "in progress",
  pane_map_state_seen: "seen, not assessed yet", pane_map_state_upcoming: "upcoming",
  pane_map_details: "Evidence and scope", pane_map_establishes: "What this state establishes",
  pane_map_not_established: "What it does not establish", pane_map_evidence: "Answers",
  pane_map_no_evidence: "No answer on this concept yet.",
  pane_map_by_key: "graded against the author's key", pane_map_by_judge: "assessed by a judge model",
  pane_map_by_self: "rated by you", pane_map_by_none: "assessed by nobody",
  pane_map_result_right: "right", pane_map_result_wrong: "wrong", pane_map_result_rated: "recall self-rated", pane_map_result_recorded: "recorded",
  pane_map_hints_one: "1 hint", pane_map_hints_many: "{count} hints", pane_map_day_unknown: "day unknown",
  pane_map_needs: "Needs: {list}", pane_map_claim_known: "I know it", pane_map_claim_unsure: "I am not sure",
  pane_map_contest_two: "Two check questions will follow.", pane_map_contest_one: "One check question will follow: the result will be partial.",
  pane_map_check_pending: "Check under way",
  pane_map_outcome_confirmed: "Last check: claim confirmed", pane_map_outcome_refuted: "Last check: claim not confirmed", pane_map_outcome_partial: "Last check: partial result",
};
const MAP = {
  concepts: [
    { id: "a", title: "Particles", state: "acquired", establishes: "Your last graded answer was right.", does_not_establish: "It does not say you will remember it.",
      evidence: [
        { scene_id: "q1", day: "2026-11-05", assessed_by: "key", result: "right", hints: 1 },
        { scene_id: "w1", day: "2026-11-06", assessed_by: "self", result: "rated", hints: 0 },
      ],
      contest: { allowed: true, claim: "unsure", questions: 2, outcome: "refuted" } },
    { id: "b", title: "Orbitals", state: "current", establishes: "This is the concept of your step.", does_not_establish: "The map concludes nothing yet.",
      evidence: [{ scene_id: "q2", day: null, assessed_by: "none", result: "recorded", hints: null }],
      contest: { allowed: true, claim: "known", questions: 1 } },
    { id: "c", title: "Spectra", state: "upcoming", establishes: "Not shown yet.", does_not_establish: "The map knows nothing of it.", evidence: [],
      contest: { allowed: false, claim: "known", questions: 0 } },
  ],
  edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "c" }],
};
const mapView = (extra = {}) => quizV2({ strings: MAP_WORDS, actions: ["respond", "hint", "end", "ask", "openMap"], ...extra });
const openMapView = (extra = {}) => mapView({ actions: ["respond", "hint", "end", "ask", "closeMap", "contest"], map: MAP, ...extra });

test("a view that offers the map shows a button for it, and one that does not shows none", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(quizV2());
  assert.equal(doc.querySelector(".map-button"), null);
  dom.window.renderView(mapView({ session_id: "two" }));
  const button = doc.querySelector(".map-button");
  assert.equal(text(button), "Concept map");
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(doc.querySelector(".concept-map"), null);
  button.click();
  assert.deepEqual(plain(sent[0][0]), { type: "openMap" });
  dom.window.close();
});

test("an open map lists every concept with its state, its answers and what the state establishes", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(mapView());
  dom.window.renderView(openMapView());
  const map = doc.querySelector(".concept-map");
  assert.ok(map, "the map is drawn");
  assert.equal(map.getAttribute("aria-labelledby"), map.querySelector(".map-title").id);
  assert.equal(text(map.querySelector(".map-title")), "Concept map");
  // The map was just opened: the keyboard and the screen reader land on its heading.
  assert.equal(doc.activeElement, map.querySelector(".map-title"));
  const items = [...map.querySelectorAll("ul.map-list > li.map-concept")];
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-concept-title"))), ["Particles", "Orbitals", "Spectra"]);
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-state"))), ["acquired", "in progress", "upcoming"]);
  assert.deepEqual(items.map((li) => li.getAttribute("data-state")), ["acquired", "current", "upcoming"]);
  // What a concept needs, in words: a list has no arrows.
  assert.deepEqual(items.map((li) => text(li.querySelector(".map-needs"))), [null, "Needs: Particles", "Needs: Particles, Orbitals"]);
  const first = items[0];
  assert.equal(text(first.querySelector("details > summary")), "Evidence and scope");
  assert.match(text(first.querySelector(".map-scope")), /What this state establishes Your last graded answer was right\. What it does not establish It does not say you will remember it\./);
  assert.deepEqual([...first.querySelectorAll(".map-evidence li")].map(text), [
    "2026-11-05 · graded against the author's key · right · 1 hint",
    "2026-11-06 · rated by you · recall self-rated",
  ]);
  assert.deepEqual([...items[1].querySelectorAll(".map-evidence li")].map(text), ["day unknown · assessed by nobody · recorded"]);
  assert.equal(text(items[2].querySelector(".map-no-evidence")), "No answer on this concept yet.");
  // The button now closes the map.
  const button = doc.querySelector(".map-button");
  assert.equal(button.getAttribute("aria-expanded"), "true");
  map.querySelector(".map-close").click();
  assert.deepEqual(plain(sent.at(-1)[0]), { type: "closeMap" });
  dom.window.close();
});

test("the claim a concept takes is a button; one question only, a check under way and the last outcome are said", () => {
  const { dom, doc, sent } = mountWithSend();
  dom.window.renderView(openMapView());
  const items = [...doc.querySelectorAll(".map-concept")];
  const claim = (li) => li.querySelector(".map-claim");
  assert.equal(text(claim(items[0])), "I am not sure");
  assert.equal(text(items[0].querySelector(".map-contest-note")), "Two check questions will follow.");
  assert.equal(text(items[0].querySelector(".map-outcome")), "Last check: claim not confirmed");
  assert.equal(text(claim(items[1])), "I know it");
  assert.equal(text(items[1].querySelector(".map-contest-note")), "One check question will follow: the result will be partial.");
  assert.equal(claim(items[2]), null);                                 // nothing to check this concept with
  claim(items[1]).click();
  assert.deepEqual(plain(sent[0][0]), { type: "contest", concept_id: "b", claim: "known" });

  // While a check is under way no claim is offered, and the concept says so.
  const pending = structuredClone(MAP);
  pending.concepts[0].contest = { allowed: false, claim: "unsure", questions: 2 };
  pending.concepts[1].contest = { allowed: false, check_pending: true, claim: "known", questions: 2 };
  dom.window.renderView(openMapView({ session_id: "two", map: pending }));
  const during = [...doc.querySelectorAll(".map-concept")];
  assert.equal(doc.querySelector(".map-claim"), null);
  assert.equal(text(during[1].querySelector(".map-check-pending")), "Check under way");

  // A view that carries the map without the contest action (an older server) offers no claim.
  dom.window.renderView(openMapView({ session_id: "three", actions: ["respond", "closeMap"] }));
  assert.equal(doc.querySelector(".map-claim"), null);
  dom.window.close();
});

test("the map is reached from the keyboard after the scene's own controls, in reading order", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(openMapView());
  const focusable = [...doc.querySelectorAll("button, input, summary, textarea, [tabindex='0']")];
  const order = (selector) => {
    const node = doc.querySelector(selector);
    assert.ok(node, `${selector} exists`);
    const at = focusable.indexOf(node);
    assert.ok(at >= 0, `${selector} is focusable`);
    assert.notEqual(node.getAttribute("tabindex"), "-1");
    return at;
  };
  const sequence = [".validate", ".map-button", ".map-close", ".map-concept details > summary", ".map-claim"].map(order);
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
  dom.window.close();
});

test("a scene view's message is said in the status line (what a contest's check showed)", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(openMapView({ message: "Two check questions on this concept." }));
  assert.equal(text(doc.querySelector("#action-status")), "Two check questions on this concept.");
  assert.match(doc.querySelector("#action-status").className, /notice/);
  dom.window.close();
});

test("feedback the learner already left is not shown again when the map opens", () => {
  const { dom, doc } = mountWithSend();
  const verdict = { scene_id: "previous", graded: true, correct: true, assessed_by: "key", feedback: "Yes." };
  dom.window.renderView(mapView({ verdict }));
  assert.ok(doc.querySelector(".feedback-step"), "the answer's feedback comes first");
  doc.querySelector(".continue").click();
  assert.ok(doc.querySelector(".map-button"), "then the scene");
  // The server answers openMap with the same verdict still on the view: the scene stays.
  doc.querySelector(".map-button").click();
  dom.window.renderView(openMapView({ verdict }));
  assert.equal(doc.querySelector(".feedback-step"), null);
  assert.ok(doc.querySelector(".concept-map"));
  // The same verdict on a view that answers no such action is a new answer (a question replayed and
  // answered the same way): its feedback is its own step.
  dom.window.renderView(openMapView({ verdict, scene: { ...QUIZ, title: "The question again" } }));
  assert.ok(doc.querySelector(".feedback-step"));
  doc.querySelector(".continue").click();
  // A new answer's feedback is shown as ever.
  doc.querySelector(".choices input").click();
  doc.querySelector(".validate").click();
  dom.window.renderView(openMapView({ session_id: "one", verdict: { ...verdict, correct: false, feedback: "No." } }));
  assert.ok(doc.querySelector(".feedback-step"));
  dom.window.close();
});

test("closing the map gives the keyboard back to its button, and a notice stays in the status line", () => {
  const { dom, doc } = mountWithSend();
  dom.window.renderView(mapView());
  dom.window.renderView(openMapView());
  dom.window.renderView(mapView());
  assert.equal(doc.activeElement, doc.querySelector(".map-button"));
  assert.equal(doc.querySelector(".concept-map"), null);
  // A notice about the scene on screen (the map could not be read) is still there once the view is painted.
  dom.window.renderView(mapView({ kind: "notice", message: "The map cannot be shown yet." }));
  assert.equal(text(doc.querySelector("#action-status")), "The map cannot be shown yet.");
  assert.match(doc.querySelector("#action-status").className, /notice/);
  dom.window.close();
});
